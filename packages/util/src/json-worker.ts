import JSON5 from "json5";

import {
  applyNonFinitePaths,
  isWorkerReady,
  makeSentinels,
  ParseRequest,
  ParseResponse,
  repairWithSentinels,
  replaceSentinelsInPlace,
  restoreRootSentinel,
} from "./json-parse-shared";
import { WorkerLauncher, workerLauncher } from "./worker";

let workerScriptUrl: string | null = null;

/**
 * Parse large inputs in workers started from `scriptUrl`: a bundled worker
 * entry that calls `serveJsonParseRequests(self)`, which an app passes in from
 * a `?worker&url` import. The app resolves it, not this package, so
 * `@tsmono/util` stays importable outside a bundler. Until this is called, and
 * after a worker fails to start, every input parses on the calling thread.
 */
export const configureJsonParseWorker = (scriptUrl: string): void => {
  workerScriptUrl = scriptUrl;
};

let warnedUnavailable = false;
const warnUnavailable = (reason: unknown): void => {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(
    "JSON parse worker unavailable; parsing on the main thread:",
    reason
  );
};

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  worker: Worker;
  sourceText?: string;
}

// Pool of workers to parse JSON/JSON5 off the main thread
class JsonWorkerPool {
  private workers: Worker[] = [];
  private launched: WorkerLauncher | null = null;
  // Settles once the first worker starts (true) or one fails first (false).
  // Nothing is sent before then, so a failed launch loses no request and
  // transfers no bytes. A failed launch is never retried: a worker that can't
  // start (a missing script, a policy blocking it) fails the same way on
  // every call, so the pool falls back to the main thread instead.
  private availability: Promise<boolean> | null = null;
  private settleLaunch: ((started: boolean) => void) | null = null;
  // Workers whose script loaded (they post a ready message).
  private started = new WeakSet<Worker>();
  private nextRequestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private readonly poolSize = 4;

  /** Whether parses go to workers; launches the pool on first use. */
  private available(): Promise<boolean> {
    // Not cached while unconfigured, so a later configureJsonParseWorker
    // still takes effect.
    if (workerScriptUrl === null) return Promise.resolve(false);
    return (this.availability ??= this.launch(workerScriptUrl));
  }

  private async launch(scriptUrl: string): Promise<boolean> {
    let launched: WorkerLauncher;
    try {
      launched = await workerLauncher(scriptUrl);
    } catch (error) {
      warnUnavailable(error);
      return false;
    }
    this.launched = launched;
    const started = new Promise<boolean>((resolve) => {
      this.settleLaunch = resolve;
    });
    try {
      for (let i = 0; i < this.poolSize; i++) {
        this.workers.push(this.createWorker(launched));
      }
    } catch (error) {
      this.settleLaunch?.(false);
      this.settleLaunch = null;
      warnUnavailable(error);
    }
    if (await started) return true;
    this.stopWorkers();
    return false;
  }

  /** Give up on workers for the rest of the session. */
  private markUnavailable(reason: unknown) {
    warnUnavailable(reason);
    this.availability = Promise.resolve(false);
    this.stopWorkers();
  }

  private stopWorkers() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.launched?.release();
    this.launched = null;
  }

  private createWorker(launcher: WorkerLauncher): Worker {
    const worker = launcher.start();
    worker.onmessage = (e) => this.handleMessage(worker, e);
    worker.onerror = (error) =>
      this.failWorker(worker, new Error(`Worker error: ${error.message}`));
    // Fires when a response can't be deserialized; there's no requestId to
    // correlate, so everything in flight on this worker must reject.
    worker.onmessageerror = () =>
      this.rejectPendingFor(
        worker,
        new Error("Worker response could not be deserialized")
      );
    return worker;
  }

  private handleMessage(worker: Worker, e: MessageEvent) {
    this.started.add(worker);
    this.settleLaunch?.(true);
    this.settleLaunch = null;
    if (isWorkerReady(e.data)) return;
    const {
      requestId,
      success,
      result,
      reparse,
      sourceText,
      nonFinitePaths,
      sentinels,
      error,
      stack,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- worker message boundary: MessageEvent.data is `any` and the payload is only what our own worker posts back
    } = e.data as ParseResponse;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    this.pendingRequests.delete(requestId);

    if (success) {
      if (reparse) {
        // The worker validated this as strict JSON; one plain JSON.parse
        // here is the cheapest way to materialize a large result on this
        // thread (structured clone of a big graph costs more, and a reviver
        // is ~8x slower than plain parse — see json-parse-worker-scope.ts). For
        // repaired payloads the worker pre-located the sentinel values, so
        // restoring NaN/Infinity is a targeted walk of just those paths (~µs).
        try {
          const parsed: unknown = JSON.parse(
            sourceText ?? pending.sourceText ?? ""
          );
          if (nonFinitePaths && sentinels) {
            applyNonFinitePaths(parsed, nonFinitePaths, sentinels);
          }
          pending.resolve(parsed);
        } catch (parseError) {
          pending.reject(parseError);
        }
      } else {
        pending.resolve(result);
      }
    } else {
      const err = new Error(error);
      if (stack) err.stack = stack;
      pending.reject(err);
    }
  }

  private rejectPendingFor(worker: Worker, err: Error) {
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.worker === worker) {
        this.pendingRequests.delete(requestId);
        pending.reject(err);
      }
    }
  }

  // A fatally-errored worker (e.g. OOM on a huge parse) can't serve further
  // requests — replace it in place so its rotation slot doesn't hang every
  // future request routed to it.
  private failWorker(worker: Worker, err: Error) {
    this.rejectPendingFor(worker, err);
    if (!this.started.has(worker) && this.settleLaunch) {
      // The first worker failed before any started: the launch failed.
      warnUnavailable(err);
      this.settleLaunch(false);
      this.settleLaunch = null;
      return;
    }
    const index = this.workers.indexOf(worker);
    worker.terminate();
    if (index < 0) return;
    if (this.started.has(worker) && this.launched) {
      this.workers[index] = this.createWorker(this.launched);
    } else {
      this.workers.splice(index, 1);
      if (this.workers.length === 0) this.markUnavailable(err);
    }
  }

  // Strings cross postMessage as a flat memcpy-style clone, which is much
  // cheaper than the TextEncoder.encode pass this used to do on the main
  // thread before transferring. The text is retained so a reparse response
  // doesn't need to ship it back.
  async parse(text: string): Promise<unknown> {
    if (!(await this.available()) || this.startedWorkers().length === 0) {
      return jsonParse(text);
    }
    return this.submit({ text }, [], text);
  }

  async parseBytes(data: Uint8Array): Promise<unknown> {
    if (!(await this.available()) || this.startedWorkers().length === 0) {
      return jsonParse(new TextDecoder("utf-8").decode(data));
    }
    // Ensure we own the full buffer before transferring
    const owned =
      data.byteOffset === 0 &&
      data.byteLength === data.buffer.byteLength &&
      data.buffer instanceof ArrayBuffer
        ? new Uint8Array(data.buffer)
        : data.slice();
    return this.submit({ bytes: owned }, [owned.buffer]);
  }

  // Least-loaded dispatch: pure round-robin would queue small requests
  // behind a multi-second parse while other workers sit idle.
  // Only workers that have started take requests: one still loading (or a
  // replacement that never will) would get, and with bytes keep, a request
  // it can't answer.
  private startedWorkers(): Worker[] {
    return this.workers.filter((worker) => this.started.has(worker));
  }

  private pickWorker(): Worker {
    const candidates = this.startedWorkers();
    const inflight = new Map<Worker, number>();
    for (const pending of this.pendingRequests.values()) {
      inflight.set(pending.worker, (inflight.get(pending.worker) ?? 0) + 1);
    }
    let best = candidates[this.nextRequestId % candidates.length]!;
    let bestCount = inflight.get(best) ?? 0;
    for (const worker of candidates) {
      const count = inflight.get(worker) ?? 0;
      if (count < bestCount) {
        best = worker;
        bestCount = count;
      }
    }
    return best;
  }

  private async submit(
    payload: { text?: string; bytes?: Uint8Array },
    transfer: Transferable[] = [],
    sourceText?: string
  ): Promise<unknown> {
    const requestId = this.nextRequestId++;
    const worker = this.pickWorker();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        worker,
        sourceText,
      });
      try {
        worker.postMessage(
          { type: "parse", requestId, ...payload } satisfies ParseRequest,
          transfer
        );
      } catch (postError) {
        // e.g. DataCloneError on an already-detached buffer — without this
        // the pending entry would leak and the promise never settle
        this.pendingRequests.delete(requestId);
        reject(
          postError instanceof Error ? postError : new Error(String(postError))
        );
      }
    });
  }
}

// Fallback for text JSON.parse rejected: try the cheap non-finite repair +
// native parse first, full JSON5 only for real JSON5 syntax. (A restoring
// reviver would be ~8x slower than plain parse + walk — see bench/.)
const parseFallback = (text: string): unknown => {
  const sentinels = makeSentinels();
  const repaired = repairWithSentinels(text, sentinels);
  if (repaired !== null) {
    let plain: unknown;
    let repairedOk = true;
    try {
      plain = JSON.parse(repaired);
    } catch {
      // repaired text still invalid — let JSON5 produce the real error
      repairedOk = false;
    }
    if (repairedOk) {
      if (typeof plain === "string") {
        // bare non-finite at the root (e.g. jsonParse("NaN"))
        return restoreRootSentinel(plain, sentinels);
      }
      replaceSentinelsInPlace(plain, sentinels);
      return plain;
    }
  }
  return JSON5.parse<unknown>(text);
};

const workerPool = new JsonWorkerPool();

// Below this size the worker round-trip costs more than it saves, so parsing
// happens synchronously on the caller's thread. Measured in UTF-16 chars for
// string inputs and bytes for byte inputs — close enough for a heuristic.
const kWorkerMinSize = 50000;

/**
 * The one unchecked step in this module. Every entry point here names a `T`
 * the parser cannot verify — the same contract `JSON.parse(text) as T` has,
 * where the shape is the caller's claim about their own data. Funnelled
 * through here so no other line in the module has to assert.
 */
const asParsed = <T>(value: unknown): T =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- unsound-by-design generic parse API; see above
  value as T;

export const asyncJsonParse = async <T>(text: string): Promise<T> => {
  if (text.length < kWorkerMinSize) {
    return jsonParse<T>(text);
  } else {
    return asParsed<T>(await workerPool.parse(text));
  }
};

/**
 * Parse JSON from raw UTF-8 bytes, avoiding redundant main-thread
 * string allocation for large payloads.
 *
 * For small data (<50KB) decodes and parses on the main thread.
 * For large data, transfers the bytes directly to a Web Worker,
 * skipping the main-thread TextDecoder.decode + TextEncoder.encode
 * round-trip that asyncJsonParse(string) would require.
 *
 * NOTE: for large inputs the bytes are TRANSFERRED to the worker — the
 * caller's Uint8Array (and its whole ArrayBuffer, when the view covers it)
 * is detached and unusable afterwards. Pass a copy if you still need the
 * bytes; passing an already-detached view rejects with a DataCloneError.
 */
export const asyncJsonParseBytes = async <T>(data: Uint8Array): Promise<T> => {
  if (data.length < kWorkerMinSize) {
    const text = new TextDecoder("utf-8").decode(data);
    return jsonParse<T>(text);
  } else {
    return asParsed<T>(await workerPool.parseBytes(data));
  }
};

export const jsonParse = <T>(text: string): T => {
  try {
    // Optimistically, try a regular JSON parse first (this is much faster)
    return asParsed<T>(JSON.parse(text));
  } catch {
    return asParsed<T>(parseFallback(text));
  }
};
