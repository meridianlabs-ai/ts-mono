import { describe, expect, it } from "vitest";

import { parseJsonRecord } from "./json";

describe("parseJsonRecord", () => {
  it("returns the parsed object for a JSON object", () => {
    expect(parseJsonRecord('{"a":1,"b":{"c":[2]}}')).toEqual({
      a: 1,
      b: { c: [2] },
    });
  });

  it("ignores surrounding whitespace, including code points JSON rejects", () => {
    // String.prototype.trim strips NBSP, BOM and the U+2028/U+2029
    // terminators; JSON.parse itself only tolerates space, tab, CR and LF.
    for (const pad of [" \n\t", "\u00A0", "\uFEFF", "\u2028", "\u3000"]) {
      expect(parseJsonRecord(`${pad}{"a":1}${pad}`)).toEqual({ a: 1 });
    }
  });

  it.each([
    ["not JSON at all", "hello"],
    ["braces around invalid JSON", "{oops}"],
    ["JSON5, not JSON", "{a: 1}"],
    ["trailing garbage", '{"a":1} x'],
    ["array", '[{"a":1}]'],
    ["scalar", "1"],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("returns undefined for %s", (_label, text) => {
    expect(parseJsonRecord(text)).toBeUndefined();
  });
});
