import { describe, expect, it } from "vitest";

import { normalizeSampleSummary } from "@tsmono/inspect-common/normalize";
import { testScore } from "@tsmono/inspect-common/testing";

import { testSampleSummary } from "../../../client/api/testClientApi";
import { SampleSummary } from "../../../client/api/types";
import type { ScoreLabel } from "../../types";
import type { SamplesDescriptor } from "../descriptor/samplesDescriptor";
import {
  testEvalDescriptor,
  testSamplesDescriptor,
  testScoreDescriptor,
} from "../descriptor/testDescriptors";
import type { EvalDescriptor } from "../descriptor/types";

import {
  bannedShortScoreNames,
  builtinFilterVariables,
  filterExpression,
  sampleFilterItems,
  sampleVariables,
} from "./filters";

const descriptorWith = (
  scores: Array<{ name: string; scorer: string; scoreType: string }>
): EvalDescriptor =>
  testEvalDescriptor({
    scores: scores.map(({ name, scorer }) => ({ name, scorer })),
    scoreDescriptor: ({ name, scorer }: ScoreLabel) => {
      const match = scores.find((s) => s.name === name && s.scorer === scorer);
      return testScoreDescriptor({ scoreType: match?.scoreType ?? "other" });
    },
  });

const samplesDescriptorWith = (
  scores: Array<{ name: string; scorer: string; scoreType: string }>
): SamplesDescriptor =>
  testSamplesDescriptor({
    evalDescriptor: descriptorWith(scores),
    selectedScorerDescriptor: () => undefined,
  });

const sample = (overrides: Partial<SampleSummary> = {}): SampleSummary =>
  testSampleSummary({
    epoch: 2,
    input: "the input",
    target: "the target",
    ...overrides,
  });

describe("builtinFilterVariables", () => {
  it("covers every name the per-sample namespace defines", () => {
    // If this fails, a new sample variable was added without extending
    // builtinFilterVariables — a score with that name would shadow it.
    const defined = Object.keys(sampleVariables(sample(), undefined));
    for (const name of defined) {
      expect(builtinFilterVariables.has(name), name).toBe(true);
    }
  });
});

describe("bannedShortScoreNames", () => {
  it("bans a score name that collides with a built-in variable", () => {
    const banned = bannedShortScoreNames([{ scorer: "grader", name: "epoch" }]);
    expect(banned.has("epoch")).toBe(true);
  });

  it("still bans duplicate names across scorers", () => {
    const banned = bannedShortScoreNames([
      { scorer: "graderA", name: "score" },
      { scorer: "graderB", name: "score" },
    ]);
    expect(banned.has("score")).toBe(true);
  });

  it("leaves unique non-colliding names usable", () => {
    const banned = bannedShortScoreNames([
      { scorer: "grader", name: "accuracy" },
    ]);
    expect(banned.has("accuracy")).toBe(false);
  });
});

describe("filterExpression built-in shadowing", () => {
  const sd = samplesDescriptorWith([
    { name: "epoch", scorer: "grader", scoreType: "numeric" },
  ]);
  const s = sample({
    scores: {
      grader: testScore({ value: { epoch: 99 } }),
    },
  });

  it("a bare built-in name reads the sample, not a score named after it", () => {
    expect(filterExpression(sd, s, "epoch == 2").matches).toBe(true);
    expect(filterExpression(sd, s, "epoch == 99").matches).toBe(false);
  });

  it("the colliding score stays reachable via its qualified name", () => {
    expect(filterExpression(sd, s, "grader.epoch == 99").matches).toBe(true);
  });
});

describe("filterExpression after score normalization", () => {
  it.each([
    { name: "null", entry: { value: null } },
    { name: "missing", entry: {} },
  ])("filters samples with a $name whole score value", ({ entry }) => {
    const normalized = normalizeSampleSummary({
      ...sample(),
      scores: { broken: entry, other: testScore({ value: 9 }) },
    });
    if (!normalized) throw new Error("Expected a sample summary");
    const descriptor = samplesDescriptorWith([
      { name: "k", scorer: "broken", scoreType: "numeric" },
      { name: "other", scorer: "other", scoreType: "numeric" },
    ]);

    for (const expression of ["epoch == 2", "other == 9"]) {
      const result = filterExpression(descriptor, normalized, expression);
      expect(result.error).toBeUndefined();
      expect(result.matches).toBe(true);
    }
  });
});

describe("sampleFilterItems with built-in collisions", () => {
  it("suggests the colliding score only in qualified form", () => {
    const items = sampleFilterItems(
      descriptorWith([
        { name: "epoch", scorer: "grader", scoreType: "numeric" },
      ])
    );
    const item = items.find((i) => i.qualifiedName === "grader.epoch");
    expect(item?.shortName).toBeUndefined();
  });

  it("skips a top-level scorer named after a built-in (no addressable form)", () => {
    const items = sampleFilterItems(
      descriptorWith([
        { name: "tokens", scorer: "tokens", scoreType: "numeric" },
      ])
    );
    expect(items).toHaveLength(0);
  });
});

describe("filterExpression results and errors", () => {
  const sd = samplesDescriptorWith([
    { name: "accuracy", scorer: "grader", scoreType: "numeric" },
  ]);
  const s = sample({
    metadata: { difficulty: "hard" },
    scores: { grader: testScore({ value: { accuracy: 0.75 } }) },
  });
  const run = (expression: string) => filterExpression(sd, s, expression);

  it("evaluates sample variables, scores, metadata and functions", () => {
    expect(run("epoch == 2 and accuracy > 0.5").matches).toBe(true);
    expect(run('metadata.difficulty == "hard"').matches).toBe(true);
    expect(run('input_contains("INPUT") and not target_contains("x")')).toEqual(
      { matches: true, error: undefined }
    );
    expect(run("epoch in (1, 2) and epoch not in (3)").matches).toBe(true);
    expect(run("if has_error then False else True").matches).toBe(true);
  });

  it("treats a missing metadata key as absent, not as an error", () => {
    expect(run("metadata.missing == None")).toEqual({
      matches: false,
      error: undefined,
    });
  });

  it("warns at an unknown variable", () => {
    expect(run("epoch == 2 and nope > 1")).toEqual({
      matches: false,
      error: {
        from: 15,
        to: 19,
        message: "Property “nope” does not exist.",
        severity: "warning",
      },
    });
  });

  it("marks where a syntax error starts", () => {
    expect(run("epoch and")).toEqual({
      matches: false,
      error: { from: 6, message: "Syntax error", severity: "error" },
    });
    expect(run("epoch == 1 #").error).toEqual({
      from: 11,
      message: "Syntax error",
      severity: "error",
    });
  });

  it("stops advancing the syntax error marker after 20 characters", () => {
    expect(run("epoch == 1 and epoch == 2 and epoch ==").error?.from).toBe(23);
  });

  it("reports runtime errors with their message", () => {
    expect(run("input > 1").error).toEqual({
      message: "Expected a number, but got a text instead.",
      severity: "error",
    });
    expect(run("nope(1)").error).toEqual({
      message: "Unknown function: nope()",
      severity: "error",
    });
    expect(run("epoch + 1").error).toEqual({
      message: "Filter expression returned a non-boolean value: 3",
      severity: "error",
    });
  });

  it("reads numbers with a leading zero as JavaScript literals did", () => {
    expect(run("epoch == 02").matches).toBe(true);
    expect(run("epoch * 4 == 010").matches).toBe(true);
  });
});
