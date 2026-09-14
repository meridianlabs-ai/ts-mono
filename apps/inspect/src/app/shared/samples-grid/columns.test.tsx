import { describe, expect, it } from "vitest";

import { testScore } from "@tsmono/inspect-common/testing";

import { testSampleSummary } from "../../../client/api/testClientApi";
import type { SampleSummary } from "../../../client/api/types";
import {
  testEvalDescriptor,
  testSamplesDescriptor,
  testScoreDescriptor,
} from "../../samples/descriptor/testDescriptors";
import {
  buildSampleFilterSpecRegistry,
  samplesOperatorsForKind,
} from "../../samples/sample-tools/filterSpecRegistry";

import type { WireScoreColorScale } from "./colorScale";
import {
  buildSampleColumns,
  SCORE_FIELD_PER_SCORER_PREFIX,
  SCORE_FIELD_RAW_PREFIX,
} from "./columns";
import type { SampleRow } from "./types";

const kField = `${SCORE_FIELD_RAW_PREFIX}quality`;

// Minimal cross-log samples with a single numeric score `quality`, used to
// exercise raw-mode score-column discovery + colour-scale wiring without a
// full SamplesDescriptor.
const samplesWith = (values: number[]): SampleSummary[] =>
  values.map((v, i): SampleSummary =>
    testSampleSummary({
      id: i,
      target: "target",
      scores: { quality: testScore({ value: v }) },
    })
  );

const rowWith = (value: number): SampleRow => ({
  logFile: "log.eval",
  sampleId: 1,
  epoch: 1,
  [kField]: value,
});

describe("buildSampleColumns score colour scales", () => {
  it("attaches a heat-map cellStyle that interpolates across the observed range", () => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: true,
      samples: samplesWith([0, 10]),
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
      samples: samplesWith([0, 10]),
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
      samples: samplesWith([0, 10]),
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
      samples: samplesWith([0, 10]),
    });
    const col = cols.find((c) => c.id === kField);
    expect(col?.meta?.rotateHeader).toBeFalsy();
    expect(col?.size).toBe(100);
  });
});

// The `TaskSamplesColumnId` wire contract: the built-in column ids eval
// authors may reference from `Task(viewer=ViewerConfig(task_samples_view=
// TaskSamplesView(columns=[...], sort=[...])))`. Source of truth is the
// Python literal in `src/inspect_ai/viewer/_config.py` (`TaskSamplesColumnId`),
// mirrored in the generated wire types (`TaskSamplesColumn.id` /
// `TaskSamplesSort.column` in `@tsmono/inspect-common` generated.ts). The
// union is widened with `| string` on the wire, so TypeScript can't enforce
// this — the ids are restated here to pin the contract at runtime.
const kTaskSamplesColumnIds = [
  "sampleStatus",
  "sampleId",
  "sampleUuid",
  "epoch",
  "input",
  "target",
  "answer",
  "tokens",
  "duration",
  "retries",
  "error",
  "limit",
] as const;

describe("buildSampleColumns TaskSamplesColumnId wire contract", () => {
  it("emits a column for every built-in TaskSamplesColumnId literal", () => {
    // Single-log mode with a descriptor — the surface `task_samples_view`
    // configures. Construction only touches `descriptor.messageShape`, so a
    // bare stub suffices (cells aren't rendered here).
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: false,
      descriptor: testSamplesDescriptor(),
    });
    const ids = new Set(cols.map((c) => c.id));
    const missing = kTaskSamplesColumnIds.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });
});

describe("buildSampleColumns registry-gated filterable pass", () => {
  it("with a registry, only mapped columns get funnels, with narrowed operators", () => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: false,
      descriptor: testSamplesDescriptor(),
      filterSpecRegistry: buildSampleFilterSpecRegistry(undefined),
    });
    // sampleId is intentionally unregistered (mixed number/string ids don't
    // round-trip through filtrex) — no funnel.
    expect(cols.find((c) => c.id === "sampleId")?.meta?.filterable).toBe(
      undefined
    );
    const input = cols.find((c) => c.id === "input");
    expect(input?.meta?.filterable).toBe(true);
    expect(input?.meta?.operators).toEqual(samplesOperatorsForKind("string"));
    const tokens = cols.find((c) => c.id === "tokens");
    expect(tokens?.meta?.filterable).toBe(true);
    expect(tokens?.meta?.operators).toEqual(samplesOperatorsForKind("number"));
  });

  it("without a registry, every column is filterable with default operators", () => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: false,
      descriptor: testSamplesDescriptor(),
    });
    const sampleId = cols.find((c) => c.id === "sampleId");
    expect(sampleId?.meta?.filterable).toBe(true);
    expect(sampleId?.meta?.operators).toBeUndefined();
  });
});

describe("buildSampleColumns non-resizable columns", () => {
  it("marks the status-icon and index columns non-resizable", () => {
    const cols = buildSampleColumns({ viewMode: "grid", multiLog: true });
    expect(cols.find((c) => c.id === "sampleStatus")?.enableResizing).toBe(
      false
    );
    expect(cols.find((c) => c.id === "displayIndex")?.enableResizing).toBe(
      false
    );
    // A normal text column stays resizable (undefined => default true).
    expect(cols.find((c) => c.id === "sampleId")?.enableResizing).not.toBe(
      false
    );
  });
});

// Score names are the keys of each sample's `scores` record, written by the
// log author. Names that are Object.prototype members must build ordinary
// columns instead of dereferencing an inherited builtin.
describe("buildSampleColumns prototype-named scores", () => {
  const names = ["constructor", "__proto__", "toString", "hasOwnProperty"];
  // A `constructor:` literal property is not contextually typed, so the
  // scale value is declared separately.
  const goodHigh: WireScoreColorScale = "good-high";

  const sampleWith = (
    scores: Record<string, ReturnType<typeof testScore>>
  ): SampleSummary => testSampleSummary({ id: 1, target: "target", scores });

  it.each(names)("discovers a raw-mode score column named %s", (name) => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: true,
      samples: [
        sampleWith({ [name]: testScore({ value: 1 }) }),
        sampleWith({ [name]: testScore({ value: 3 }) }),
      ],
      scoreColorScales: {},
    });
    const col = cols.find((c) => c.id === `${SCORE_FIELD_RAW_PREFIX}${name}`);
    expect(col?.header).toBe(name);
    expect(col?.meta?.sortComparator).toBeDefined();
  });

  it.each(names)(
    "labels a per-scorer column named %s with its own name",
    (name) => {
      const cols = buildSampleColumns({
        viewMode: "grid",
        multiLog: false,
        descriptor: testSamplesDescriptor({
          evalDescriptor: testEvalDescriptor({
            scoreDescriptor: () => testScoreDescriptor(),
          }),
        }),
        scores: [
          { name, scorer: "scorer" },
          { name: "other", scorer: "scorer" },
        ],
        scoreLabels: {},
        scoreColorScales: {},
      });
      const col = cols.find(
        (c) => c.id === `${SCORE_FIELD_PER_SCORER_PREFIX}scorer__${name}`
      );
      expect(col?.header).toBe(name);
    }
  );

  it("still applies an own label and colour scale for such a name", () => {
    const cols = buildSampleColumns({
      viewMode: "grid",
      multiLog: true,
      samples: [
        sampleWith({ constructor: testScore({ value: 0 }) }),
        sampleWith({ constructor: testScore({ value: 10 }) }),
      ],
      scoreLabels: { constructor: "Constructor" },
      scoreColorScales: { constructor: goodHigh },
    });
    const col = cols.find(
      (c) => c.id === `${SCORE_FIELD_RAW_PREFIX}constructor`
    );
    expect(col?.header).toBe("Constructor");
    expect(col?.meta?.cellStyle).toBeDefined();
  });
});
