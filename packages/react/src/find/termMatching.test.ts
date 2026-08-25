import { describe, expect, it } from "vitest";

import { findTermOccurrences, prepareFindTerm } from "./termMatching";

describe("prepareFindTerm", () => {
  it("returns only the simple variant for plain terms", () => {
    expect(prepareFindTerm("Hello")).toEqual({ simple: "hello" });
  });

  it("adds unquoted and JSON-escaped variants for quoted terms", () => {
    expect(prepareFindTerm('say "hi"')).toEqual({
      simple: 'say "hi"',
      unquoted: "say hi",
      jsonEscaped: 'say \\"hi\\"',
    });
  });
});

describe("findTermOccurrences", () => {
  it("finds all case-insensitive occurrences", () => {
    expect(findTermOccurrences("Foo foo FOO", "foo")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("returns nothing for an empty term", () => {
    expect(findTermOccurrences("anything", "")).toEqual([]);
  });

  it("dedupes overlapping variant hits, longest variant winning", () => {
    // `"foo"` matches both the simple form and the unquoted form; the
    // overlapping hits collapse to one occurrence spanning the quoted form.
    const occurrences = findTermOccurrences('a "foo" b', '"foo"');
    expect(occurrences).toEqual([{ start: 2, end: 7 }]);
  });

  it("matches the JSON-escaped variant in stringified text", () => {
    const text = '{"say":"\\"hi\\""}';
    expect(findTermOccurrences(text, '"hi"')).toHaveLength(1);
  });

  it("does not advance past non-overlapping adjacent matches", () => {
    expect(findTermOccurrences("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});
