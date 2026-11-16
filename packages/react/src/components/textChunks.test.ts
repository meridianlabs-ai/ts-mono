import { describe, expect, it } from "vitest";

import { lineLengths, splitTextChunks, wrappedRows } from "./textChunks";

describe("splitTextChunks", () => {
  it("returns text shorter than the chunk size as one chunk", () => {
    expect(splitTextChunks("a\nb\n", 10)).toEqual([
      { text: "a\nb\n", lines: 2 },
    ]);
  });

  it("ends each chunk after a newline and preserves the text exactly", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const chunks = splitTextChunks(text, 50);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith("\n")).toBe(true);
      expect(chunk.text.length).toBeLessThanOrEqual(50);
    }
  });

  it("breaks a single long line after a space or comma near the target", () => {
    const text = "x".repeat(30) + "," + "y".repeat(30);
    const chunks = splitTextChunks(text, 40);
    expect(chunks.map((c) => c.text)).toEqual([
      "x".repeat(30) + ",",
      "y".repeat(30),
    ]);
  });

  it("hard-splits a line with no break opportunity", () => {
    const text = "z".repeat(25);
    expect(splitTextChunks(text, 10).map((c) => c.text)).toEqual([
      "z".repeat(10),
      "z".repeat(10),
      "z".repeat(5),
    ]);
  });

  it("counts a trailing partial line", () => {
    expect(splitTextChunks("a\nb", 10)[0]?.lines).toBe(2);
    expect(splitTextChunks("a\nb\n", 10)[0]?.lines).toBe(2);
    expect(splitTextChunks("", 10)).toEqual([]);
  });

  it("never splits a surrogate pair", () => {
    const text = `a${"😀".repeat(30)}`;
    const chunks = splitTextChunks(text, 10);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    for (const chunk of chunks) {
      const last = chunk.text.charCodeAt(chunk.text.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });
});

describe("wrappedRows", () => {
  it("counts a row per line, plus a row per width's worth a line wraps onto", () => {
    const lengths = lineLengths(
      ["", "abc", "x".repeat(10), "x".repeat(11)].join("\n")
    );
    expect(wrappedRows(lengths, 10)).toBe(1 + 1 + 1 + 2);
    expect(wrappedRows(lengths, 3)).toBe(1 + 1 + 4 + 4);
  });
});
