import type { Decompress as ZstdDecompress } from "fzstd";

// Self-contained: the same typed implementation is embedded in the Blob worker
// via toString(), matching the viewer's JSON worker pattern.
export function createZstdDecoder(Decompress: typeof ZstdDecompress) {
  /**
   * Maximum history allocation allowed by the viewer (2^25 = 32 MiB).
   */
  const MAX_WINDOW_LOG = 25;
  // fzstd copies its history after every block. Budget this work separately
  // from live allocation to bound tiny-frame/block amplification.
  // Keep an absolute ceiling: input padding must not buy more decoder work.
  const MAX_HISTORY_WORK = 32 * 1024 * 1024 * 1024;
  const MAX_FRAME_BLOCK_COUNT = 1_000_000;

  /**
   * Error thrown when zstd data uses a window size too large for fzstd.
   */
  class ZstdWindowSizeError extends Error {
    public readonly windowLog: number;
    public readonly maxWindowLog: number;

    constructor(windowLog: number) {
      super(
        `Zstd window size too large (windowLog=${windowLog}, max=${MAX_WINDOW_LOG}). ` +
          `The viewer supports zstd frames with history windows up to 32 MiB. ` +
          `Recompress using smaller zstd frames or ZIP deflate.`
      );
      this.name = "ZstdWindowSizeError";
      this.windowLog = windowLog;
      this.maxWindowLog = MAX_WINDOW_LOG;

      Object.setPrototypeOf(this, ZstdWindowSizeError.prototype);
    }
  }

  // Scan every frame before fzstd allocates its history window. In particular,
  // single-segment frames use their content size as the window size.
  function scanFrames(
    data: Uint8Array,
    expectedSize: number,
    onFrame?: (frame: Uint8Array) => void
  ): number {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    let historyWork = 0;
    let frameBlockCount = 0;
    const countOperation = () => {
      if (++frameBlockCount > MAX_FRAME_BLOCK_COUNT) {
        throw new Error("Zstd frame/block count exceeds the viewer budget");
      }
    };
    const addHistoryWork = (size: number) => {
      historyWork += size;
      if (historyWork > MAX_HISTORY_WORK) {
        throw new Error(
          "Zstd history work exceeds the 32 GiB viewer budget; use smaller windows or ZIP deflate"
        );
      }
    };
    const requireBytes = (count: number) => {
      if (count > data.length - offset) throw new Error("Truncated zstd frame");
    };
    while (offset < data.length) {
      countOperation();
      const frameStart = offset;
      requireBytes(4);
      const magic = view.getUint32(offset, true);
      offset += 4;
      if ((magic & 0xfffffff0) === 0x184d2a50) {
        requireBytes(4);
        const size = view.getUint32(offset, true);
        offset += 4;
        requireBytes(size);
        offset += size;
        continue;
      }
      if (magic !== 0xfd2fb528) throw new Error("Invalid zstd frame");
      requireBytes(1);
      const descriptor = view.getUint8(offset++);
      const singleSegment = (descriptor & 32) !== 0;
      let windowSize = 0;
      if (!singleSegment) {
        requireBytes(1);
        const windowDescriptor = view.getUint8(offset++);
        const base = 2 ** (10 + (windowDescriptor >> 3));
        windowSize = base + (base / 8) * (windowDescriptor & 7);
      }
      const dictionaryFlag = descriptor & 3;
      const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
      requireBytes(dictionaryBytes);
      offset += dictionaryBytes;
      const sizeFlag = descriptor >> 6;
      const sizeBytes = sizeFlag ? 2 ** sizeFlag : singleSegment ? 1 : 0;
      requireBytes(sizeBytes);
      let contentSize = sizeFlag === 1 ? 256 : 0;
      for (let index = 0; index < sizeBytes; index++) {
        contentSize += view.getUint8(offset++) * 256 ** index;
      }
      if (
        sizeBytes &&
        (!Number.isSafeInteger(contentSize) || contentSize > expectedSize)
      ) {
        throw new Error("Zstd frame size exceeds its ZIP entry size");
      }
      if (singleSegment) windowSize = contentSize;
      if (windowSize > 2 ** MAX_WINDOW_LOG) {
        throw new ZstdWindowSizeError(Math.ceil(Math.log2(windowSize)));
      }
      addHistoryWork(windowSize);
      let last = false;
      while (!last) {
        countOperation();
        requireBytes(3);
        const block =
          view.getUint8(offset) + view.getUint16(offset + 1, true) * 256;
        offset += 3;
        last = (block & 1) !== 0;
        const type = (block >> 1) & 3;
        const size = block >> 3;
        if (type === 3 || size > 128 * 1024)
          throw new Error("Invalid zstd block");
        addHistoryWork(windowSize);
        const compressedSize = type === 1 ? 1 : size;
        requireBytes(compressedSize);
        offset += compressedSize;
      }
      if (descriptor & 4) {
        requireBytes(4);
        offset += 4;
      }
      onFrame?.(data.subarray(frameStart, offset));
    }
    // Even empty blocks have parsing/allocation overhead and must leave the UI thread.
    return Math.max(historyWork, frameBlockCount * 1024);
  }

  function decompress(data: Uint8Array, expectedSize: number): Uint8Array {
    scanFrames(data, expectedSize);
    // Pack small decoder outputs into fixed pages, so memory tracks bytes rather
    // than attacker-controlled block counts. Allocate only as output arrives.
    const pages: Uint8Array[] = [];
    let page = new Uint8Array();
    let used = 0;
    let total = 0;
    const collect = (chunk: Uint8Array) => {
      total += chunk.length;
      if (total > expectedSize)
        throw new Error("Zstd output exceeds its ZIP entry size");
      let offset = 0;
      while (offset < chunk.length) {
        if (used === page.length) {
          page = new Uint8Array(Math.min(64 * 1024, expectedSize));
          pages.push(page);
          used = 0;
        }
        const count = Math.min(chunk.length - offset, page.length - used);
        page.set(chunk.subarray(offset, offset + count), used);
        offset += count;
        used += count;
      }
    };
    // fzstd recurses between frames within one push. Give each frame its own
    // stream so valid concatenations cannot exhaust the JavaScript call stack.
    scanFrames(data, expectedSize, (frame) => {
      const stream = new Decompress(collect);
      stream.push(frame, true);
    });
    if (total !== expectedSize)
      throw new Error("Zstd output does not match its ZIP entry size");
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of pages) {
      const count = Math.min(part.length, total - offset);
      result.set(part.subarray(0, count), offset);
      offset += count;
    }
    return result;
  }
  return { scanFrames, decompress, ZstdWindowSizeError };
}
