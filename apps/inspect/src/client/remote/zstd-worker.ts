/**
 * Zstandard decompression via Web Worker.
 *
 * Provides a simple async interface for zstd decompression that automatically
 * uses a Web Worker for large payloads to avoid blocking the main thread.
 *
 * Uses Blob URL to load the worker, which works in VSCode webviews that have
 * CORS restrictions preventing external worker script loading.
 */

import { Decompress } from "fzstd";

import { kFzstdBase64, kZstdWorkerCode } from "./zstd-worker-code";

/**
 * Threshold for using a Web Worker (1MB compressed or expected output).
 * Below this, synchronous decompression is fast enough.
 */
const WORKER_THRESHOLD = 1024 * 1024;

/**
 * Maximum history allocation allowed by the viewer (2^25 = 32 MiB).
 */
const MAX_WINDOW_LOG = 25;
// fzstd copies its history after every block. Budget this work separately
// from live allocation to bound tiny-frame/block amplification.
const MAX_HISTORY_WORK = 32 * 1024 * 1024 * 1024;

/**
 * Error thrown when zstd data uses a window size too large for fzstd.
 */
export class ZstdWindowSizeError extends Error {
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
function validateZstdFrames(data: Uint8Array, expectedSize: number): boolean {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  let historyWork = 0;
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
  }
  return historyWork >= WORKER_THRESHOLD;
}

function decompressZstdBounded(
  data: Uint8Array,
  expectedSize: number
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Decompress((chunk) => {
    total += chunk.length;
    if (total > expectedSize)
      throw new Error("Zstd output exceeds its ZIP entry size");
    chunks.push(chunk);
  });
  stream.push(data, true);
  if (total !== expectedSize)
    throw new Error("Zstd output does not match its ZIP entry size");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Messages posted back by the zstd worker (see kZstdWorkerCode).
interface ZstdInitMessage {
  type: "init_complete";
  success: boolean;
  error?: string;
}

interface ZstdDecompressMessage {
  requestId: number;
  success: boolean;
  data?: Uint8Array;
  error?: string;
}

/** Cached worker and blob URL */
let zstdWorker: Worker | null = null;
let blobURL: string | null = null;
let workerInitPromise: Promise<Worker> | null = null;

/** Request ID counter for worker messages */
let nextRequestId = 0;

/** Pending decompression requests */
const pendingRequests = new Map<
  number,
  { resolve: (value: Uint8Array) => void; reject: (error: Error) => void }
>();

/** Whether message handlers have been attached to the worker */
let handlersAttached = false;

/**
 * Gets or creates the zstd decompression worker.
 * Uses a Blob URL to work in VSCode webviews which have CORS restrictions.
 * Returns a promise that resolves when the worker is fully initialized.
 */
function getZstdWorker(): Promise<Worker> {
  if (workerInitPromise) {
    return workerInitPromise;
  }

  workerInitPromise = new Promise((resolve, reject) => {
    // Create worker from inline code using Blob URL
    // This avoids CORS issues in VSCode webviews
    const blob = new Blob([kZstdWorkerCode], {
      type: "application/javascript",
    });
    blobURL = URL.createObjectURL(blob);
    zstdWorker = new Worker(blobURL);

    // Wait for init confirmation before resolving
    const initHandler = (event: MessageEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- worker message boundary: MessageEvent.data is `any`, and the payload is only what our own zstd worker posts back
      const message = event.data as ZstdInitMessage;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the assertion above names the message we want; other message types reach this same listener at runtime
      if (message.type === "init_complete") {
        zstdWorker!.removeEventListener("message", initHandler);
        if (message.success) {
          resolve(zstdWorker!);
        } else {
          reject(new Error(message.error || "Worker initialization failed"));
        }
      }
    };
    zstdWorker.addEventListener("message", initHandler);

    // Send the fzstd library code to initialize the worker
    zstdWorker.postMessage({
      type: "init",
      scriptContent: kFzstdBase64,
    });
  });

  return workerInitPromise;
}

/**
 * Decompresses zstd-compressed data.
 *
 * For payloads with both compressed and expected output sizes below 1MB, uses synchronous decompression.
 * For larger payloads, uses a Web Worker to avoid blocking the main thread.
 *
 * Data transfer efficiency:
 * - Input data is transferred (zero-copy) to the worker
 * - Output data is transferred (zero-copy) back from the worker
 *
 * @param data - The zstd-compressed data
 * @param expectedSize - Validated ZIP output size, enforced while streaming
 * @returns Promise resolving to the decompressed data
 */
export async function decompressZstd(
  data: Uint8Array,
  expectedSize: number
): Promise<Uint8Array> {
  // Check window size before attempting decompression
  const requiresWorker = validateZstdFrames(data, expectedSize);

  // For small data, synchronous is faster (avoids worker overhead)
  if (
    !requiresWorker &&
    data.length < WORKER_THRESHOLD &&
    expectedSize < WORKER_THRESHOLD
  ) {
    return decompressZstdBounded(data, expectedSize);
  }

  // For large data, use Web Worker to avoid blocking UI
  // Wait for worker to be fully initialized first
  const worker = await getZstdWorker();

  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++;

    pendingRequests.set(requestId, { resolve, reject });

    // Only add listeners once
    if (!handlersAttached) {
      handlersAttached = true;

      worker.addEventListener("message", (event: MessageEvent) => {
        const {
          requestId: respId,
          success,
          data: resultData,
          error,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- worker message boundary: see initHandler above
        } = event.data as ZstdDecompressMessage;
        const pending = pendingRequests.get(respId);
        if (!pending) return;

        pendingRequests.delete(respId);

        if (success && resultData) {
          pending.resolve(resultData);
        } else {
          pending.reject(new Error(error || "Decompression failed"));
        }
      });

      worker.addEventListener("error", (error: ErrorEvent) => {
        // Reject all pending requests on worker error
        for (const [id, pending] of pendingRequests) {
          pending.reject(new Error(`Worker error: ${error.message}`));
          pendingRequests.delete(id);
        }
      });
    }

    // Transfer the input buffer to avoid copying (zero-copy transfer)
    // Note: After transfer, the original data.buffer becomes detached/unusable
    worker.postMessage(
      {
        type: "decompress",
        requestId,
        data,
        expectedSize,
      },
      [data.buffer]
    );
  });
}
