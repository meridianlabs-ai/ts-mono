import { describe, expect, it } from "vitest";

import { fmtShortDuration } from "./timeFormat";

describe("fmtShortDuration", () => {
  it.each([
    [0, "<0.1s"],
    [0.04, "<0.1s"],
    [0.42, "0.4s"],
    [3.1, "3.1s"],
    [3.02, "3s"],
    [12.34, "12.3s"],
    [59.94, "59.9s"],
    [59.96, "1m"],
    [75.2, "1m 15s"],
  ])("formats %s seconds as %s", (seconds, text) => {
    expect(fmtShortDuration(seconds)).toBe(text);
  });

  it("renders nothing for a missing time", () => {
    expect(fmtShortDuration(null)).toBeUndefined();
    expect(fmtShortDuration(undefined)).toBeUndefined();
  });
});
