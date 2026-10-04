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

import { createZstdDecoder } from "./zstd-decoder";
import { kFzstdBase64, kZstdWorkerCode } from "./zstd-worker-code";

/**
 * Threshold for using a Web Worker (1MB compressed or expected output).
 * Below this, synchronous decompression is fast enough.
 */
const WORKER_THRESHOLD = 1024 * 1024;

const decoder = createZstdDecoder(Decompress);
export const ZstdWindowSizeError = decoder.ZstdWindowSizeError;

let zstdWorker: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<
  number,
  { resolve: (value: Uint8Array) => void; reject: (error: Error) => void }
>();

function messageError(message: object, fallback: string): Error {
  return new Error(
    "error" in message && typeof message.error === "string"
      ? message.error
      : fallback
  );
}

function getZstdWorker(): Promise<Worker> {
  if (workerInitPromise) return workerInitPromise;
  const blobURL = URL.createObjectURL(
    new Blob([kZstdWorkerCode], { type: "application/javascript" })
  );
  let worker: Worker;
  try {
    worker = new Worker(blobURL);
  } finally {
    URL.revokeObjectURL(blobURL);
  }
  zstdWorker = worker;
  workerInitPromise = new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      if (zstdWorker !== worker) return;
      reject(error);
      for (const pending of pendingRequests.values()) pending.reject(error);
      pendingRequests.clear();
      worker.terminate();
      zstdWorker = null;
      workerInitPromise = null;
    };
    worker.addEventListener("error", (event: ErrorEvent) =>
      fail(new Error(`Worker error: ${event.message}`))
    );
    worker.addEventListener("messageerror", () =>
      fail(new Error("Worker response could not be deserialized"))
    );
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (typeof message !== "object" || message === null) return;
      if ("type" in message && message.type === "init_complete") {
        if ("success" in message && message.success === true) resolve(worker);
        else fail(messageError(message, "Worker initialization failed"));
        return;
      }
      if (!("requestId" in message) || typeof message.requestId !== "number")
        return;
      const pending = pendingRequests.get(message.requestId);
      if (!pending) return;
      pendingRequests.delete(message.requestId);
      if (
        "success" in message &&
        message.success === true &&
        "data" in message &&
        message.data instanceof Uint8Array
      ) {
        pending.resolve(message.data);
      } else {
        pending.reject(messageError(message, "Decompression failed"));
      }
    });
    // Defer posting until the promise is cached, so synchronous send failures
    // can clear it and allow the next read to initialize a fresh worker.
    queueMicrotask(() => {
      try {
        worker.postMessage({ type: "init", scriptContent: kFzstdBase64 });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
  return workerInitPromise;
}

/**
 * Drop the cached worker so the next large read starts a fresh one. For
 * tests: the worker is a module-level singleton, and a test file that
 * installs its own `Worker` and terminates the threads it created must also
 * forget the promise here, or the next file sharing this module graph posts
 * to a dead worker and never hears back.
 */
export function resetZstdWorker(): void {
  zstdWorker?.terminate();
  zstdWorker = null;
  workerInitPromise = null;
  pendingRequests.clear();
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
  const requiresWorker =
    decoder.scanFrames(data, expectedSize) >= WORKER_THRESHOLD;

  // For small data, synchronous is faster (avoids worker overhead)
  if (
    !requiresWorker &&
    data.length < WORKER_THRESHOLD &&
    expectedSize < WORKER_THRESHOLD
  ) {
    return decoder.decompress(data, expectedSize);
  }

  // For large data, use Web Worker to avoid blocking UI
  // Wait for worker to be fully initialized first
  const worker = await getZstdWorker();

  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++;

    pendingRequests.set(requestId, { resolve, reject });

    // Transfer the input buffer to avoid copying (zero-copy transfer)
    // Note: After transfer, the original data.buffer becomes detached/unusable
    try {
      worker.postMessage(
        {
          type: "decompress",
          requestId,
          data,
          expectedSize,
        },
        [data.buffer]
      );
    } catch (error) {
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
