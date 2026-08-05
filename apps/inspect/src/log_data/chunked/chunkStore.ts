/**
 * The framework-free chunk-byte store and per-sequence readers for chunked
 * samples (design/large-samples.md, "Data-loading architecture").
 *
 * Two tiers: `ChunkByteStore` owns raw decompressed entry bytes with a
 * byte-budget LRU and in-flight request dedup (raw ArrayBuffers live outside
 * the V8 heap cage; parsed objects are the scarce resource, owned by
 * callers). `SequenceReader` layers chunk math + JSON parsing + `getRange`
 * over it for one sequence.
 */
import { at, chunkIndexOf } from "./format";
import { log } from "./log";

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;

/** Byte-level access to zip entries (what remoteZipFile's open* return). */
export interface EntryByteSource {
  readFile: (name: string) => Promise<Uint8Array>;
}

export const DEFAULT_BYTE_BUDGET = 256 * 1024 * 1024;

/**
 * LRU-cached, request-deduped reads of decompressed entry bytes. Eviction
 * is by total cached bytes against a generous budget; in-flight reads are
 * never evicted (they only enter the cache on settle).
 */
export class ChunkByteStore {
  private cache = new Map<string, Uint8Array>();
  private inflight = new Map<string, Promise<Uint8Array>>();
  private cachedBytes = 0;

  constructor(
    private source: EntryByteSource,
    private byteBudget: number = DEFAULT_BYTE_BUDGET
  ) {}

  read(name: string): Promise<Uint8Array> {
    const cached = this.cache.get(name);
    if (cached) {
      log.debug(`byte-cache hit ${name} (${kb(cached.byteLength)})`);
      // touch: Map iteration order is the LRU order
      this.cache.delete(name);
      this.cache.set(name, cached);
      return Promise.resolve(cached);
    }
    let pending = this.inflight.get(name);
    if (!pending) {
      const startedAt = performance.now();
      pending = this.source
        .readFile(name)
        .then((bytes) => {
          this.cache.set(name, bytes);
          this.cachedBytes += bytes.byteLength;
          log.info(
            `fetch ${name} — ${kb(bytes.byteLength)} in ` +
              `${(performance.now() - startedAt).toFixed(0)}ms ` +
              `(byte cache ${kb(this.cachedBytes)})`
          );
          this.evict();
          return bytes;
        })
        .finally(() => {
          this.inflight.delete(name);
        });
      this.inflight.set(name, pending);
    } else {
      log.debug(`fetch dedup ${name} (already in flight)`);
    }
    return pending;
  }

  private evict(): void {
    for (const [name, bytes] of this.cache) {
      if (this.cachedBytes <= this.byteBudget || this.cache.size === 1) {
        return;
      }
      this.cache.delete(name);
      this.cachedBytes -= bytes.byteLength;
      log.info(`evict ${name} (${kb(bytes.byteLength)}) — over byte budget`);
    }
  }

  get size(): number {
    return this.cachedBytes;
  }

  clear(): void {
    this.cache.clear();
    this.cachedBytes = 0;
  }
}

const decoder = new TextDecoder();

/** Chunks kept parsed per sequence; scroll-back re-parses from bytes. */
const PARSED_CHUNK_CAP = 32;

/**
 * Random access over one chunked sequence: index→chunk resolution from
 * central-directory chunk starts, JSON parse on top of the byte store, and
 * half-open `getRange`. A small parsed-chunk LRU absorbs the walk's
 * re-reads; the byte store below makes cap misses a re-parse, not a
 * re-download.
 */
export class SequenceReader<T> {
  private parsed = new Map<number, Promise<T[]>>();

  constructor(
    private bytes: ChunkByteStore,
    private entryNameFor: (start: number) => string,
    /** Ascending chunk start indexes (from `sequenceChunkStarts`). */
    readonly starts: readonly number[],
    /**
     * Exact item count when known — the events reader derives it from the
     * stats sidecar. Undefined otherwise: the format persists no sequence
     * counts (chunk starts come from entry names), so an unknown count is
     * only learnable by parsing the last chunk. In-range `getRange` calls
     * never depend on it.
     */
    readonly count: number | undefined,
    /**
     * Optional per-chunk post-parse transform (e.g. attachment-ref
     * resolution), applied once per parsed chunk and cached with it.
     */
    private transform?: (items: T[], start: number) => Promise<T[]>
  ) {}

  /** A reader over the same chunks with `transform` applied post-parse. */
  withTransform(
    transform: (items: T[], start: number) => Promise<T[]>
  ): SequenceReader<T> {
    return new SequenceReader(
      this.bytes,
      this.entryNameFor,
      this.starts,
      this.count,
      transform
    );
  }

  /** Exact count (coding error to read on a count-less sequence). */
  get knownCount(): number {
    if (this.count === undefined) {
      throw new Error("sequence count unknown (no stats-backed count)");
    }
    return this.count;
  }

  /** Index of the chunk holding item `i`: greatest start ≤ i. */
  chunkIndexOf(i: number): number {
    return chunkIndexOf(this.starts, i);
  }

  /**
   * `[start, end_exclusive)` of a chunk. The last chunk's end is the
   * sequence count — coding error on a count-less sequence (bounds
   * consumers are events-side, where stats supply the count).
   */
  chunkBounds(chunkIdx: number): [number, number] {
    const start = at(this.starts, chunkIdx);
    return [start, this.starts[chunkIdx + 1] ?? this.knownCount];
  }

  loadChunk(chunkIdx: number): Promise<T[]> {
    const start = at(this.starts, chunkIdx);
    let pending = this.parsed.get(start);
    if (!pending) {
      const name = this.entryNameFor(start);
      pending = this.bytes
        .read(name)
        .then((bytes) => {
          const items = JSON.parse(decoder.decode(bytes)) as T[];
          log.debug(`parse ${name}: ${items.length} items`);
          return items;
        })
        .then((items) => this.transform?.(items, start) ?? items);
      // identity check: a cap eviction + fresh loadChunk can replace this
      // entry before the rejection lands — don't delete the newer one
      const inserted = pending;
      pending.catch(() => {
        if (this.parsed.get(start) === inserted) {
          this.parsed.delete(start);
        }
      });
      this.parsed.set(start, pending);
      for (const key of this.parsed.keys()) {
        if (this.parsed.size <= PARSED_CHUNK_CAP) {
          break;
        }
        this.parsed.delete(key);
        log.debug(
          `parsed-cache evict ${this.entryNameFor(key)} — over ${PARSED_CHUNK_CAP}-chunk cap`
        );
      }
    } else {
      // touch: Map iteration order is the LRU order
      this.parsed.delete(start);
      this.parsed.set(start, pending);
    }
    return pending;
  }

  /**
   * Items `[lo, hi)` — fetches the covering chunks in parallel. When the
   * count is unknown, an out-of-range `hi` is clamped by the data itself
   * (the last chunk yields what it holds).
   */
  async getRange(lo: number, hi: number): Promise<T[]> {
    lo = Math.max(0, lo);
    if (this.count !== undefined) {
      hi = Math.min(hi, this.count);
    }
    if (hi <= lo || this.starts.length === 0) {
      return [];
    }
    const firstChunk = this.chunkIndexOf(lo);
    const lastChunk = this.chunkIndexOf(hi - 1);
    const chunks = await Promise.all(
      Array.from({ length: lastChunk - firstChunk + 1 }, (_, k) =>
        this.loadChunk(firstChunk + k)
      )
    );
    const base = at(this.starts, firstChunk);
    return chunks.flat().slice(lo - base, hi - base);
  }
}
