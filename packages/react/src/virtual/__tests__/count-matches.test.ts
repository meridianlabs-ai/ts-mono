import { describe, expect, it } from "vitest";

import { countMatchesByItem } from "../VirtualList";

describe("countMatchesByItem", () => {
  it("counts every occurrence per item, across its fields", () => {
    const texts = [["foo bar foo"], ["baz"], ["baz", "foofoo"]];
    expect(countMatchesByItem(texts, "foo")).toEqual([
      { item: 0, count: 2 },
      { item: 2, count: 2 },
    ]);
  });

  it("counts without overlap, advancing by term length", () => {
    expect(countMatchesByItem([["aaaa"]], "aa")).toEqual([
      { item: 0, count: 2 },
    ]);
  });

  it("returns nothing for no match or empty input", () => {
    expect(countMatchesByItem([["hello"]], "zzz")).toEqual([]);
    expect(countMatchesByItem([], "x")).toEqual([]);
  });

  it("counts a quoted term in JSON-escaped data, once per occurrence", () => {
    const args = JSON.stringify({ cmd: 'print("hi")' }).toLowerCase();
    expect(
      countMatchesByItem([[args], ['print("hi")']], 'print("hi")')
    ).toEqual([
      { item: 0, count: 1 },
      { item: 1, count: 1 },
    ]);
  });

  it("returns nothing for an empty term without spinning", () => {
    expect(countMatchesByItem([["aaaa"]], "")).toEqual([]);
  });
});
