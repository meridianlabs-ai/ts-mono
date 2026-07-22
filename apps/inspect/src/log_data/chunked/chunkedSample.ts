/**
 * The open path for a chunked sample: parse the shell + sidecars and build
 * per-sequence readers over one shared chunk-byte store. Everything here is
 * plain byte-range/entry reads — no server endpoint is ever required
 * (design/large-samples.md, core principle "sealed logs = range reads
 * only").
 */
import type { ChatMessage } from "@tsmono/inspect-common";

import {
  ChunkByteStore,
  SequenceReader,
  type EntryByteSource,
} from "./chunkStore";
import {
  chunkEntryName,
  metadataEntryName,
  sequenceChunkStarts,
  shellEntryName,
  skeletonEntryName,
  statsEntryName,
  uuidsEntryName,
} from "./format";
import { log } from "./log";
import { SkeletonIndex } from "./skeletonIndex";
import type {
  ChunkedEvent,
  ChunkedSampleShell,
  EventChunkStats,
  EventStats,
  SampleSkeleton,
} from "./types";

export interface ChunkedSample {
  shell: ChunkedSampleShell;
  skeleton: SampleSkeleton;
  skel: SkeletonIndex;
  stats: EventChunkStats[];
  events: SequenceReader<ChunkedEvent>;
  messages: SequenceReader<ChatMessage>;
  calls: SequenceReader<unknown>;
  attachments: SequenceReader<string>;
  /**
   * Resolve an event uuid to its ordinal via `events/uuids.json` (fetched
   * lazily, once). Undefined for unknown uuids — including every uuid on a
   * log converted before the sidecar existed.
   */
  uuidToOrdinal: (uuid: string) => Promise<number | undefined>;
  /** Fetch `metadata.json` (undefined when the sample has no metadata). */
  readMetadata?: () => Promise<Record<string, unknown>>;
}

const decoder = new TextDecoder();

const readJson = async <T>(
  source: EntryByteSource,
  name: string
): Promise<T> => {
  const startedAt = performance.now();
  const bytes = await source.readFile(name);
  // "fetch" = range-read member bytes + decompress, same operation the
  // chunk-byte store logs; sidecars just bypass its LRU (fetched once per
  // sample open, no re-read to cache for).
  log.info(
    `fetch ${name} — ${(bytes.byteLength / 1024).toFixed(1)}KB in ` +
      `${(performance.now() - startedAt).toFixed(0)}ms (sidecar, uncached)`
  );
  return JSON.parse(decoder.decode(bytes)) as T;
};

/**
 * Open a chunked sample. `entryNames` is the log's central-directory name
 * set — the persisted chunk layout (per-sequence starts) plus optional
 * metadata detection; the three parsed artifacts — shell, skeleton,
 * stats — are fetched in parallel.
 */
export const openChunkedSample = async (
  source: EntryByteSource,
  entryNames: ReadonlySet<string>,
  id: string | number,
  epoch: number,
  byteBudget?: number
): Promise<ChunkedSample> => {
  const [shell, skeleton, stats] = await Promise.all([
    readJson<ChunkedSampleShell>(source, shellEntryName(id, epoch)),
    readJson<SampleSkeleton>(source, skeletonEntryName(id, epoch)),
    readJson<EventStats>(source, statsEntryName(id, epoch)),
  ]);

  // the exact events count: sequence counts are not persisted, but the
  // stats sidecar's per-chunk type counts sum to it
  const eventsCount = stats.chunks.reduce(
    (n, chunk) =>
      n + Object.values(chunk.type_counts).reduce((a, b) => a + b, 0),
    0
  );

  const bytes = new ChunkByteStore(source, byteBudget);
  const reader = <T>(
    sequence: "messages" | "events" | "calls" | "attachments",
    count?: number
  ) =>
    new SequenceReader<T>(
      bytes,
      (start) => chunkEntryName(id, epoch, sequence, start),
      sequenceChunkStarts(entryNames, id, epoch, sequence),
      count
    );

  const uuidsEntry = uuidsEntryName(id, epoch);
  let uuidOrdinals: Promise<Map<string, number>> | undefined;
  const uuidToOrdinal = async (uuid: string): Promise<number | undefined> => {
    if (!entryNames.has(uuidsEntry)) {
      return undefined; // log converted before the sidecar existed
    }
    uuidOrdinals ??= readJson<(string | null)[]>(source, uuidsEntry).then(
      (uuids) =>
        new Map(
          uuids.flatMap((u, ordinal): [string, number][] =>
            u === null ? [] : [[u, ordinal]]
          )
        )
    );
    return (await uuidOrdinals).get(uuid);
  };

  const metadataEntry = metadataEntryName(id, epoch);
  return {
    shell,
    skeleton,
    skel: new SkeletonIndex(skeleton),
    stats: stats.chunks,
    events: reader<ChunkedEvent>("events", eventsCount),
    messages: reader<ChatMessage>("messages"),
    calls: reader<unknown>("calls"),
    attachments: reader<string>("attachments"),
    uuidToOrdinal,
    ...(entryNames.has(metadataEntry)
      ? {
          readMetadata: () =>
            readJson<Record<string, unknown>>(source, metadataEntry),
        }
      : {}),
  };
};
