import { describe, expect, it } from "vitest";

import {
  getRailParam,
  getValidationParam,
  kRailQueryParam,
  kValidationQueryParam,
  kValidationSetQueryParam,
  nextRailValue,
  transcriptRoute,
  updateRailParam,
  updateValidationParam,
} from "./url";

describe("validation param helpers", () => {
  it("opens the validation sidebar with validation=1", () => {
    const params = new URLSearchParams(
      "sidebar=search&tab=transcript-events&other=keep"
    );
    const next = updateValidationParam(params, true);
    expect(next.get(kValidationQueryParam)).toBe("1");
    expect(next.has("sidebar")).toBe(false);
    expect(getValidationParam(next)).toBe(true);
    expect(next.get("tab")).toBe("transcript-events");
    expect(next.get("other")).toBe("keep");
    expect(params.has(kValidationQueryParam)).toBe(false);
  });

  it("does not treat the search sidebar as validation", () => {
    expect(getValidationParam(new URLSearchParams("search=1"))).toBe(false);
  });

  it("deep-links a validation set via the rail param", () => {
    const route = transcriptRoute(
      "transcripts",
      "sample-1",
      undefined,
      "/tmp/cases.csv"
    );
    expect(route).toContain(`${kRailQueryParam}=validation`);
    expect(route).toContain(kValidationSetQueryParam);
  });
});

describe("rail param", () => {
  it("sets and reads the rail panel id", () => {
    const next = updateRailParam(new URLSearchParams(), "search");
    expect(next.get(kRailQueryParam)).toBe("search");
    expect(getRailParam(next)).toBe("search");
  });

  it("clears the param when given undefined", () => {
    const params = new URLSearchParams("rail=validation");
    const next = updateRailParam(params, undefined);
    expect(next.has(kRailQueryParam)).toBe(false);
    expect(getRailParam(next)).toBeUndefined();
  });

  it("switching writes the new id (mutually exclusive)", () => {
    const params = new URLSearchParams("rail=search");
    const next = updateRailParam(params, "validation");
    expect(next.get(kRailQueryParam)).toBe("validation");
  });

  it("ignores unknown values", () => {
    expect(getRailParam(new URLSearchParams("rail=bogus"))).toBeUndefined();
  });

  it("nextRailValue toggles the active id off and switches otherwise", () => {
    expect(nextRailValue("search", "search")).toBeUndefined();
    expect(nextRailValue("search", "validation")).toBe("validation");
    expect(nextRailValue(undefined, "search")).toBe("search");
  });
});
