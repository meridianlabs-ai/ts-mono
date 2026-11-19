import { describe, expect, it } from "vitest";

import type { Score } from "@tsmono/inspect-common/types";

import { hasScanResults } from "./useSampleScans";

const kMessageRef = { type: "message", id: "m1", cite: "[M1]" };

const score = (value: Score["value"], references: unknown[] = []): Score => ({
  value,
  answer: null,
  explanation: "no match",
  metadata: { scanner_references: references },
  history: [],
});

describe("hasScanResults", () => {
  it("is false when every scanner has a falsy value and no references", () => {
    expect(hasScanResults({})).toBe(false);
    expect(
      hasScanResults({
        nan: score(NaN),
        false: score(false),
        zero: score(0),
        empty: score(""),
        list: score([]),
        dict: score({}),
      })
    ).toBe(false);
  });

  it("is true when any scanner has a truthy value", () => {
    expect(hasScanResults({ a: score(false), b: score(true) })).toBe(true);
    expect(hasScanResults({ a: score({ label: 1 }) })).toBe(true);
  });

  it("is true when a falsy-valued scanner cites references", () => {
    expect(hasScanResults({ a: score(false, [kMessageRef]) })).toBe(true);
  });
});
