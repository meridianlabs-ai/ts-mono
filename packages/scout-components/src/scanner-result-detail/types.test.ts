import { describe, expect, it } from "vitest";

import { isNumberValue } from "./types";

describe("isNumberValue", () => {
  it("accepts a number value", () => {
    expect(isNumberValue({ valueType: "number", value: 3 })).toBe(true);
  });

  it("rejects a number-typed row whose value is not a number", () => {
    expect(isNumberValue({ valueType: "number", value: null })).toBe(false);
  });
});
