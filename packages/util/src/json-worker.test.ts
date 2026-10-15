import { afterEach, describe, expect, test, vi } from "vitest";

import { asyncJsonParse, asyncJsonParseBytes, jsonParse } from "./json-worker";

// Only the small-payload (<50KB) main-thread paths are testable here: the
// worker path needs a real Web Worker, which this environment lacks. The
// worker path is exercised end-to-end (with correctness checks) by
// bench/run-bench.mjs in real Chromium.

describe("jsonParse", () => {
  test("parses plain JSON", () => {
    expect(jsonParse<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  test("falls back to JSON5", () => {
    expect(jsonParse<{ a: number[] }>("{a: [1, 2, 3,], /* c */}")).toEqual({
      a: [1, 2, 3],
    });
  });

  test("throws on invalid input", () => {
    expect(() => jsonParse("not json at all {{{")).toThrow();
  });

  // Python's json.dumps emits bare NaN/Infinity, which is invalid JSON but
  // valid JSON5 — the reason the fallback exists. These must survive intact.
  test("preserves NaN and Infinity via JSON5", () => {
    const result = jsonParse<{ a: number; b: number; c: number; d: null }>(
      "{a: NaN, b: Infinity, c: -Infinity, d: null}"
    );
    expect(result.a).toBeNaN();
    expect(result.b).toBe(Infinity);
    expect(result.c).toBe(-Infinity);
    expect(result.d).toBeNull();
  });

  // Bare non-finite tokens in otherwise-strict JSON take the repair +
  // native-JSON.parse fast path; these exercise its edge cases.
  describe("non-finite repair fast path", () => {
    test("bare NaN/Infinity/-Infinity in strict JSON", () => {
      const result = jsonParse<{
        a: number;
        b: number;
        c: number;
        d: number[];
      }>('{"a": NaN, "b": Infinity, "c": -Infinity, "d": [1, NaN, -2.5e+3]}');
      expect(result.a).toBeNaN();
      expect(result.b).toBe(Infinity);
      expect(result.c).toBe(-Infinity);
      expect(result.d[0]).toBe(1);
      expect(result.d[1]).toBeNaN();
      expect(result.d[2]).toBe(-2500);
    });

    test("tokens inside string values are untouched", () => {
      const result = jsonParse<{ s: string; t: string; x: number }>(
        '{"s": "decoys: NaN, Infinity, -Infinity", "t": "esc \\" NaN", "x": NaN}'
      );
      expect(result.s).toBe("decoys: NaN, Infinity, -Infinity");
      expect(result.t).toBe('esc " NaN');
      expect(result.x).toBeNaN();
    });

    test("negative numbers and exponents pass through", () => {
      expect(
        jsonParse<number[]>("[-1, -2.5, 1e+10, 3E-7, NaN]").slice(0, 4)
      ).toEqual([-1, -2.5, 1e10, 3e-7]);
    });

    test("true/false/null literals coexist with bare tokens", () => {
      const result = jsonParse<{
        t: boolean;
        f: boolean;
        n: null;
        x: number;
      }>('{"t": true, "f": false, "n": null, "x": Infinity}');
      expect(result).toMatchObject({ t: true, f: false, n: null });
      expect(result.x).toBe(Infinity);
    });

    test("real JSON5 syntax still falls back to JSON5.parse", () => {
      // unquoted keys + comments can't be repaired, only JSON5-parsed
      const result = jsonParse<{ a: number; b: number }>(
        "{a: NaN, /* c */ b: 2,}"
      );
      expect(result.a).toBeNaN();
      expect(result.b).toBe(2);
    });

    // NaN/Infinity can appear as unquoted JSON5 object KEYS; replacing those
    // would silently rename the key, so they must route to JSON5.parse.
    test("bare tokens in key position keep their names", () => {
      expect(jsonParse("{NaN: 1}")).toEqual({ NaN: 1 });
      expect(jsonParse("{Infinity: 2}")).toEqual({ Infinity: 2 });
      expect(jsonParse('{"a": {NaN: true}}')).toEqual({ a: { NaN: true } });
      expect(jsonParse("{ NaN\t : 1 }")).toEqual({ NaN: 1 });
      // key and value in the same document
      const mixed = jsonParse<Record<string, number>>('{NaN: 1, "x": NaN}');
      expect(mixed["NaN"]).toBe(1);
      expect(mixed["x"]).toBeNaN();
    });

    test("bare non-finite at the root", () => {
      expect(jsonParse("NaN")).toBeNaN();
      expect(jsonParse("Infinity")).toBe(Infinity);
      expect(jsonParse("-Infinity")).toBe(-Infinity);
    });

    test("survives nesting far deeper than the call stack", () => {
      const depth = 20000;
      const text = "[".repeat(depth) + "NaN" + "]".repeat(depth);
      let node: unknown = jsonParse(text);
      for (let i = 0; i < depth; i++) {
        if (!Array.isArray(node)) break;
        node = node[0];
      }
      expect(node).toBeNaN();
    });

    test("malformed input still throws", () => {
      expect(() => jsonParse('{"a": NaN,')).toThrow();
      expect(() => jsonParse('{"a": Nope}')).toThrow();
    });
  });
});

describe("asyncJsonParse (main-thread path)", () => {
  test("parses plain JSON", async () => {
    await expect(asyncJsonParse('{"x": [1, "two", null]}')).resolves.toEqual({
      x: [1, "two", null],
    });
  });

  test("falls back to JSON5", async () => {
    await expect(asyncJsonParse("{unquoted: 'single'}")).resolves.toEqual({
      unquoted: "single",
    });
  });

  test("preserves NaN and Infinity via JSON5", async () => {
    const result = await asyncJsonParse<{ x: number; y: number }>(
      "{x: NaN, y: -Infinity}"
    );
    expect(result.x).toBeNaN();
    expect(result.y).toBe(-Infinity);
  });

  test("parses a payload just under the worker threshold", async () => {
    const arr = Array.from({ length: 1500 }, (_, i) => ({ i }));
    const text = JSON.stringify(arr);
    expect(text.length).toBeLessThan(50000);
    await expect(asyncJsonParse(text)).resolves.toEqual(arr);
  });

  test("rejects on invalid input", async () => {
    await expect(asyncJsonParse("{{{")).rejects.toThrow();
  });
});

describe("asyncJsonParseBytes (main-thread path)", () => {
  const encode = (s: string) => new TextEncoder().encode(s);

  test("parses plain JSON bytes", async () => {
    await expect(asyncJsonParseBytes(encode('{"n": 42}'))).resolves.toEqual({
      n: 42,
    });
  });

  test("falls back to JSON5", async () => {
    await expect(asyncJsonParseBytes(encode("{n: 42,}"))).resolves.toEqual({
      n: 42,
    });
  });

  test("handles a subarray view", async () => {
    const padded = encode('xx{"ok": true}yy');
    const view = padded.subarray(2, padded.length - 2);
    await expect(asyncJsonParseBytes(view)).resolves.toEqual({ ok: true });
  });

  test("rejects on invalid input", async () => {
    await expect(asyncJsonParseBytes(encode("]["))).rejects.toThrow();
  });
});

// The pool's lifecycle, with a stand-in Worker: the parse itself runs in real
// Chromium (json-worker.browser.test.ts).
describe("worker pool lifecycle", () => {
  const largeArray = `[${"1,".repeat(30_000)}1]`;
  const parsedLargeArray: unknown = JSON.parse(largeArray);
  // What a stand-in worker answers, so a test can tell it from a
  // main-thread parse.
  const fromWorker = "parsed by a worker";

  // "loading" never posts ready or errors: its script is still loading.
  type Behavior = "starts" | "never-starts" | "starts-then-dies" | "loading";
  let workers: StubWorker[] = [];

  class StubWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    answered = false;
    received = 0;

    constructor(readonly behavior: Behavior) {
      workers.push(this);
      queueMicrotask(() => {
        if (behavior === "loading") return;
        if (behavior === "never-starts") {
          this.onerror?.({ message: "script blocked" });
        } else {
          this.onmessage?.({ data: { type: "ready" } });
        }
      });
    }

    postMessage(message: { requestId: number }): void {
      this.received++;
      queueMicrotask(() => {
        if (this.behavior === "starts-then-dies") {
          this.onerror?.({ message: "out of memory" });
          return;
        }
        this.answered = true;
        this.onmessage?.({
          data: {
            requestId: message.requestId,
            success: true,
            result: fromWorker,
          },
        });
      });
    }

    terminate(): void {
      this.terminated = true;
    }
  }

  const loadPool = async (behavior: () => Behavior, configure = true) => {
    workers = [];
    vi.resetModules();
    vi.stubGlobal("location", new URL("http://viewer.test/"));
    vi.stubGlobal(
      "Worker",
      class extends StubWorker {
        constructor() {
          super(behavior());
        }
      }
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = await import("./json-worker");
    if (configure) {
      pool.configureJsonParseWorker("/assets/json-parse.worker.js");
    }
    return pool;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("parses on the main thread until an app configures a worker", async () => {
    const { asyncJsonParse } = await loadPool(() => "starts", false);
    await expect(asyncJsonParse(largeArray)).resolves.toEqual(parsedLargeArray);
    expect(workers).toHaveLength(0);
  });

  test("parses in a worker once one starts", async () => {
    const { asyncJsonParse } = await loadPool(() => "starts");
    await expect(asyncJsonParse(largeArray)).resolves.toBe(fromWorker);
  });

  test("falls back to the main thread for good when no worker starts", async () => {
    const { asyncJsonParse, asyncJsonParseBytes } = await loadPool(
      () => "never-starts"
    );
    await expect(asyncJsonParse(largeArray)).resolves.toEqual(parsedLargeArray);
    // Nothing was sent before the launch failed, so bytes aren't transferred
    // to a dead worker, and later calls don't start more workers.
    await expect(
      asyncJsonParseBytes(new TextEncoder().encode(largeArray))
    ).resolves.toEqual(parsedLargeArray);
    expect(workers).toHaveLength(4);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  test("a worker that started but dies on a job is replaced", async () => {
    const { asyncJsonParse } = await loadPool(() => "starts-then-dies");
    await expect(asyncJsonParse(largeArray)).rejects.toThrow(
      "Worker error: out of memory"
    );
    expect(workers).toHaveLength(5);
  });

  test("a worker that fails after answering is replaced", async () => {
    let behavior: Behavior = "starts";
    const { asyncJsonParse } = await loadPool(() => behavior);
    await expect(asyncJsonParse(largeArray)).resolves.toBe(fromWorker);
    const busy = workers.find((worker) => worker.answered);
    behavior = "starts-then-dies";
    busy?.onerror?.({ message: "out of memory" });
    expect(busy?.terminated).toBe(true);
    expect(workers).toHaveLength(5);
  });

  test("concurrent first calls wait for the launch and send nothing to workers that never start", async () => {
    const { asyncJsonParse, asyncJsonParseBytes } = await loadPool(
      () => "never-starts"
    );
    await expect(
      Promise.all([
        asyncJsonParse(largeArray),
        asyncJsonParseBytes(new TextEncoder().encode(largeArray)),
      ])
    ).resolves.toEqual([parsedLargeArray, parsedLargeArray]);
    expect(workers.every((worker) => worker.received === 0)).toBe(true);
  });

  test("uses a worker configured after an earlier large parse", async () => {
    const pool = await loadPool(() => "starts", false);
    await expect(pool.asyncJsonParse(largeArray)).resolves.toEqual(
      parsedLargeArray
    );
    pool.configureJsonParseWorker("/assets/json-parse.worker.js");
    await expect(pool.asyncJsonParse(largeArray)).resolves.toBe(fromWorker);
  });

  test("sends requests only to workers that have started", async () => {
    let behavior: Behavior = "starts";
    const { asyncJsonParse } = await loadPool(() => behavior);
    await expect(asyncJsonParse(largeArray)).resolves.toBe(fromWorker);
    behavior = "loading";
    workers[0]?.onerror?.({ message: "out of memory" });
    const replacement = workers[4];

    // Enough concurrent requests that least-loaded dispatch would reach the
    // replacement if it counted; then fail it, as a script that never loads.
    const calls = Promise.all(
      Array.from({ length: 4 }, () => asyncJsonParse(largeArray))
    );
    const received = () =>
      workers.reduce((total, worker) => total + worker.received, 0);
    await vi.waitFor(() => expect(received()).toBe(5));
    replacement?.onerror?.({ message: "script blocked" });

    await expect(calls).resolves.toEqual(Array(4).fill(fromWorker));
    expect(replacement?.received).toBe(0);
  });

  test("falls back to the main thread once every replacement fails to start", async () => {
    let behavior: Behavior = "starts";
    const { asyncJsonParse } = await loadPool(() => behavior);
    await expect(asyncJsonParse(largeArray)).resolves.toBe(fromWorker);
    behavior = "never-starts";
    for (const worker of workers.slice(0, 4)) {
      worker.onerror?.({ message: "out of memory" });
    }
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledTimes(1));
    await expect(asyncJsonParse(largeArray)).resolves.toEqual(parsedLargeArray);
  });

  test("falls back to the main thread when the only started worker dies while the rest still load", async () => {
    let created = 0;
    const { asyncJsonParse, asyncJsonParseBytes } = await loadPool(() =>
      created++ === 0 ? "starts-then-dies" : "loading"
    );
    await expect(asyncJsonParse(largeArray)).rejects.toThrow(
      "Worker error: out of memory"
    );
    await expect(asyncJsonParse(largeArray)).resolves.toEqual(parsedLargeArray);
    await expect(
      asyncJsonParseBytes(new TextEncoder().encode(largeArray))
    ).resolves.toEqual(parsedLargeArray);
    expect(workers.slice(1).every((worker) => worker.received === 0)).toBe(
      true
    );
  });
});
