import { describe, expect, it } from "vitest";

import type { LogDetails } from "../../../client/api/types";

import { buildSampleColumns, SCORE_FIELD_RAW_PREFIX } from "./columns";
import type { SampleRow } from "./types";

const kField = `${SCORE_FIELD_RAW_PREFIX}quality`;

// Minimal cross-log details with a single numeric score `quality`, used to
// exercise raw-mode score-column discovery + colour-scale wiring without a
// full SamplesDescriptor.
const detailsWith = (values: number[]): Record<string, LogDetails> => ({
  "log.eval": {
    sampleSummaries: values.map((v, i) => ({
      id: i,
      epoch: 1,
      scores: { quality: { value: v } },
    })),
  } as unknown as LogDetails,
});

const rowWith = (value: number): SampleRow =>
  ({ [kField]: value }) as unknown as SampleRow;

describe("buildSampleColumns score colour scales", () => {
  it("attaches a heat-map cellStyle that interpolates across the observed range", () => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: true,
      logDetails: detailsWith([0, 10]),
      scoreColorScales: { quality: "good-high" },
    });
    const col = cols.find((c) => c.id === kField);
    expect(col).toBeDefined();

    // good-high: high values resolve toward success (green), low toward danger.
    expect(col?.meta?.cellStyle?.(rowWith(10))?.backgroundColor).toContain(
      "var(--bs-success-bg-subtle)"
    );
    expect(col?.meta?.cellStyle?.(rowWith(0))?.backgroundColor).toContain(
      "var(--bs-danger-bg-subtle)"
    );
  });

  it("attaches no cellStyle when colour scales are absent (toggle off → empty map)", () => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: true,
      logDetails: detailsWith([0, 10]),
      scoreColorScales: {},
    });
    expect(cols.find((c) => c.id === kField)?.meta?.cellStyle).toBeUndefined();
  });
});

describe("buildSampleColumns compact scores", () => {
  it("rotates + narrows score columns when compactScores is on", () => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: true,
      logDetails: detailsWith([0, 10]),
      compactScores: true,
    });
    const col = cols.find((c) => c.id === kField);
    expect(col?.meta?.rotateHeader).toBe(true);
    // Numeric score → ~40px compact width, far below the wide default (100).
    expect(col?.size).toBeLessThanOrEqual(40);
  });

  it("leaves score columns wide + un-rotated when compactScores is off", () => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: true,
      logDetails: detailsWith([0, 10]),
    });
    const col = cols.find((c) => c.id === kField);
    expect(col?.meta?.rotateHeader).toBeFalsy();
    expect(col?.size).toBe(100);
  });
});
