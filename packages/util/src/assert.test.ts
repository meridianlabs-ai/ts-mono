import { describe, expect, it } from "vitest";

import { expectDefined } from "./assert";

describe("expectDefined", () => {
  it("returns defined values, including falsy ones", () => {
    expect(expectDefined(0, "a count")).toBe(0);
    expect(expectDefined(null, "a node")).toBeNull();
  });

  it("throws naming what was missing", () => {
    expect(() => expectDefined([1][1], "the second item")).toThrow(
      "Expected the second item"
    );
  });
});
