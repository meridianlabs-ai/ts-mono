import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

import { build } from "esbuild";
import { afterAll, beforeEach, vi } from "vitest";

import { resetDecompressionWorker } from "../client/remote/decompression-worker";

const kProjectRoot = new URL("../../", import.meta.url);

// Vitest resolves `?worker&url` imports to "/@fs/<absolute path>?worker_file…"
// outside the project and "/<project-relative path>?…" inside it.
const entryPath = (url: string | URL): string => {
  const { pathname } = new URL(url, "http://localhost/");
  return fileURLToPath(
    pathname.startsWith("/@fs/")
      ? `file://${pathname.slice("/@fs".length)}`
      : new URL(pathname.slice(1), kProjectRoot)
  );
};

// Bundle a worker entry to one self-contained script, as the app build does.
const bundleWorker = async (entry: string): Promise<string> => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error(`No worker bundle for ${entry}`);
  return output.text;
};

// Run the production worker entries and their real transfer lists in Node.
// These corpus tests exercise the worker path for large entries too.
export function installNodeWorker(): void {
  const workers = new Set<NodeWorker>();
  const bundles = new Map<string, Promise<string>>();
  class ScriptWorker extends EventTarget {
    private readonly ready: Promise<NodeWorker>;

    constructor(url: string | URL) {
      super();
      const entry = entryPath(url);
      let script = bundles.get(entry);
      if (!script) {
        script = bundleWorker(entry);
        bundles.set(entry, script);
      }
      this.ready = script.then((code) => {
        const worker = new NodeWorker(
          `const { parentPort } = require("node:worker_threads");
           const target = new EventTarget();
           globalThis.self = globalThis;
           self.addEventListener = target.addEventListener.bind(target);
           self.postMessage = (data, options) =>
             parentPort.postMessage(data, options ? options.transfer : []);
           parentPort.on("message", (data) =>
             target.dispatchEvent(new MessageEvent("message", { data })));
           ${code}`,
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

  // Per test, since some files unstub all globals after each one.
  beforeEach(() => {
    vi.stubGlobal("Worker", ScriptWorker);
    vi.stubGlobal("location", new URL("http://localhost/"));
  });
  afterAll(async () => {
    // The production module caches one worker for the whole module graph,
    // which under `isolate: false` outlives this file. Forget it before
    // killing its thread, so the next file gets a live one.
    resetDecompressionWorker();
    await Promise.all([...workers].map((worker) => worker.terminate()));
    vi.unstubAllGlobals();
  });
}
