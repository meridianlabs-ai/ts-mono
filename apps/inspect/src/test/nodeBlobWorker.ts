import { resolveObjectURL } from "node:buffer";
import { Worker as NodeWorker } from "node:worker_threads";

import { afterAll, beforeAll, vi } from "vitest";

import { resetZstdWorker } from "../client/remote/zstd-worker";

// Run the production Blob worker script and its real transfer lists in Node.
// These corpus tests now exercise the worker path for large zstd windows too.
export function installNodeBlobWorker(): void {
  const workers = new Set<NodeWorker>();
  class BlobWorker extends EventTarget {
    private readonly ready: Promise<NodeWorker>;

    constructor(url: string) {
      super();
      const blob = resolveObjectURL(url);
      if (!blob) throw new Error(`Unknown worker Blob URL: ${url}`);
      this.ready = blob.text().then((script) => {
        const worker = new NodeWorker(
          `const { parentPort } = require("node:worker_threads");
           globalThis.module = undefined;
           globalThis.exports = undefined;
           globalThis.self = globalThis;
           self.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
           parentPort.on("message", data => self.onmessage({ data }));
           ${script}`,
          { eval: true }
        );
        workers.add(worker);
        worker.on("message", (data: unknown) => {
          this.dispatchEvent(new MessageEvent("message", { data }));
        });
        worker.on("error", (error) => this.reportError(error));
        return worker;
      });
    }

    postMessage(data: unknown, transfer: ArrayBuffer[] = []): void {
      this.ready
        .then((worker) => worker.postMessage(data, transfer))
        .catch((error: unknown) => this.reportError(error));
    }

    terminate(): void {
      this.ready
        .then((worker) => worker.terminate())
        .catch((error: unknown) => this.reportError(error));
    }

    private reportError(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      this.dispatchEvent(Object.assign(new Event("error"), { message }));
    }
  }

  beforeAll(() => vi.stubGlobal("Worker", BlobWorker));
  afterAll(async () => {
    // The production module caches one worker for the whole module graph,
    // which under `isolate: false` outlives this file. Forget it before
    // killing its thread, so the next file gets a live one.
    resetZstdWorker();
    await Promise.all([...workers].map((worker) => worker.terminate()));
    vi.unstubAllGlobals();
  });
}
