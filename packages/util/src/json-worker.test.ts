import { describe, expect, test } from "vitest";

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
