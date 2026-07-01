import { describe, expect, it } from "vitest";

import { shouldLoadSample } from "./useLoadSample";

const base = {
  identifierMatches: false,
  hasSampleData: false,
  isLoading: false,
  isError: false,
  logFileChanged: false,
  sampleIdChanged: false,
  completedChanged: false,
  needsReloadChanged: false,
};

describe("shouldLoadSample", () => {
  it("loads a newly selected sample even while a previous sample is still streaming", () => {
    // Regression: navigating away from a running sample leaves status
    // "streaming" (isLoading true) for the *previous* sample. On a remount the
    // change flags are all false, so this must still trigger a load — the
    // stale streaming status is for a different sample (identifier mismatch).
    expect(
      shouldLoadSample({ ...base, identifierMatches: false, isLoading: true })
    ).toBe(true);
  });

  it("does not reload while the selected sample is itself loading", () => {
    // Identifier matches but data not yet present: a load is in flight for
    // this sample, so don't re-trigger.
    expect(
      shouldLoadSample({
        ...base,
        identifierMatches: true,
        hasSampleData: false,
        isLoading: true,
      })
    ).toBe(false);
  });

  it("does not reload when the selected sample is already loaded", () => {
    expect(
      shouldLoadSample({
        ...base,
        identifierMatches: true,
        hasSampleData: true,
      })
    ).toBe(false);
  });

  it("loads a newly selected sample after a previous sample errored", () => {
    expect(
      shouldLoadSample({ ...base, identifierMatches: false, isError: true })
    ).toBe(true);
  });

  it("does not reload the selected sample when it is the one in error", () => {
    expect(
      shouldLoadSample({ ...base, identifierMatches: true, isError: true })
    ).toBe(false);
  });

  it("reloads when a meaningful change flag is set", () => {
    expect(shouldLoadSample({ ...base, sampleIdChanged: true })).toBe(true);
    expect(shouldLoadSample({ ...base, needsReloadChanged: true })).toBe(true);
  });
});
