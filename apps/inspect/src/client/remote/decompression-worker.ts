/// <reference types="@tsmono/util/worker-url" />
/**
 * ZIP entry decompression (zstd and DEFLATE) via Web Worker.
 *
 * Small entries decompress synchronously; larger ones go to a worker so they
 * don't block the main thread. The worker is a bundled script started through
 * workerLauncher, which also covers VS Code webviews' cross-origin assets.
 */

import { Decompress } from "fzstd";

import { workerLauncher } from "@tsmono/util";

import workerUrl from "./decompression.worker?worker&url";
import { inflateBounded } from "./inflate";
import { createZstdDecoder } from "./zstd-decoder";

/**
 * Threshold for using a Web Worker (1MB compressed or expected output).
 * Below this, synchronous decompression is fast enough.
 */
const WORKER_THRESHOLD = 1024 * 1024;

const decoder = createZstdDecoder(Decompress);
export const ZstdWindowSizeError = decoder.ZstdWindowSizeError;

type Method = "zstd" | "deflate";

let worker: Worker | null = null;
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

async function startWorker(): Promise<Worker> {
  const launcher = await workerLauncher(workerUrl);
  const started = launcher.start();
  // The launcher's Blob URL (VS Code) is only needed to construct the worker.
  launcher.release();
  return started;
}

function initWorker(started: Worker): Promise<Worker> {
  return new Promise((resolve, reject) => {
    worker = started;
    const fail = (error: Error) => {
      if (worker !== started) return;
      reject(error);
      for (const pending of pendingRequests.values()) pending.reject(error);
      pendingRequests.clear();
      started.terminate();
      worker = null;
      workerInitPromise = null;
    };
    started.addEventListener("error", (event: ErrorEvent) =>
      fail(new Error(`Worker error: ${event.message}`))
    );
    started.addEventListener("messageerror", () =>
      fail(new Error("Worker response could not be deserialized"))
    );
    started.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (typeof message !== "object" || message === null) return;
      if ("type" in message && message.type === "init_complete") {
        if ("success" in message && message.success === true) resolve(started);
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
    try {
      started.postMessage({ type: "init" });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function getWorker(): Promise<Worker> {
  if (workerInitPromise) return workerInitPromise;
  const init = startWorker().then(initWorker);
  workerInitPromise = init;
  // A launch or init failure clears the cache so the next read starts fresh.
  init.catch(() => {
    if (workerInitPromise === init) workerInitPromise = null;
  });
  return init;
}

/**
 * Drop the cached worker so the next large read starts a fresh one. For
 * tests: the worker is a module-level singleton, and a test file that
 * installs its own `Worker` and terminates the threads it created must also
 * forget the promise here, or the next file sharing this module graph posts
 * to a dead worker and never hears back.
 */
export function resetDecompressionWorker(): void {
  worker?.terminate();
  worker = null;
  workerInitPromise = null;
  pendingRequests.clear();
}

async function decompressInWorker(
  method: Method,
  data: Uint8Array,
  expectedSize: number
): Promise<Uint8Array> {
  // Wait for worker to be fully initialized first
  const ready = await getWorker();

  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++;

    pendingRequests.set(requestId, { resolve, reject });

    // Transfer the input buffer to avoid copying (zero-copy transfer)
    // Note: After transfer, the original data.buffer becomes detached/unusable
    try {
      ready.postMessage(
        { type: "decompress", method, requestId, data, expectedSize },
        [data.buffer]
      );
    } catch (error) {
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const isSmall = (data: Uint8Array, expectedSize: number): boolean =>
  data.length < WORKER_THRESHOLD && expectedSize < WORKER_THRESHOLD;

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
  if (!requiresWorker && isSmall(data, expectedSize)) {
    return decoder.decompress(data, expectedSize);
  }
  return decompressInWorker("zstd", data, expectedSize);
}

/**
 * Decompresses DEFLATE data, with the same size threshold and transfer
 * behaviour as decompressZstd.
 *
 * @param data - The DEFLATE-compressed data
 * @param expectedSize - Validated ZIP output size, enforced while streaming
 * @returns Promise resolving to the decompressed data
 */
export async function decompressDeflate(
  data: Uint8Array,
  expectedSize: number
): Promise<Uint8Array> {
  if (isSmall(data, expectedSize)) {
    return inflateBounded(data, expectedSize);
  }
  return decompressInWorker("deflate", data, expectedSize);
}
