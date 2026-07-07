import { describe, expect, it } from "vitest";

import type { ScoreLabel } from "../../../app/types";
import type { EvalDescriptor, ScoreDescriptor } from "../descriptor/types";

import {
  buildSampleFilterSpecRegistry,
  samplesOperatorsForKind,
} from "./filterSpecRegistry";

const descriptorWith = (
  scores: Array<{ name: string; scorer: string; scoreType: string }>
): EvalDescriptor =>
  ({
    scores: scores.map(({ name, scorer }) => ({ name, scorer })),
    scoreDescriptor: ({ name, scorer }: ScoreLabel) => {
      const match = scores.find((s) => s.name === name && s.scorer === scorer);
      return { scoreType: match?.scoreType ?? "other" } as ScoreDescriptor;
    },
  }) as unknown as EvalDescriptor;

describe("buildSampleFilterSpecRegistry", () => {
  it("registers the static columns", () => {
    const reg = buildSampleFilterSpecRegistry(undefined);
    expect(reg.byColId.get("epoch")).toEqual({
      variable: "epoch",
      kind: "number",
    });
    expect(reg.byColId.get("input")).toEqual({
      variable: "input",
      kind: "string",
      containsFn: "input_contains",
    });
    expect(reg.byColId.get("sampleUuid")).toEqual({
      variable: "uuid",
      kind: "string",
    });
    expect(reg.byVariable.get("uuid")).toBe("sampleUuid");
    expect(reg.byColId.has("sampleId")).toBe(false);
    expect(reg.byVariable.has("id")).toBe(false);
  });

  it("registers numeric and categorical scores, skips boolean/complex", () => {
    const reg = buildSampleFilterSpecRegistry(
      descriptorWith([
        { name: "accuracy", scorer: "grader", scoreType: "numeric" },
        { name: "grade", scorer: "grader", scoreType: "passfail" },
        { name: "flag", scorer: "grader", scoreType: "boolean" },
      ])
    );
    expect(reg.byColId.get("score__grader__accuracy")).toEqual({
      variable: "accuracy",
      kind: "number",
    });
    expect(reg.byColId.get("score__grader__grade")).toEqual({
      variable: "grade",
      kind: "string",
    });
    expect(reg.byColId.has("score__grader__flag")).toBe(false);
    expect(reg.byVariable.get("accuracy")).toBe("score__grader__accuracy");
  });

  it("qualifies ambiguous short score names as scorer.name", () => {
    const reg = buildSampleFilterSpecRegistry(
      descriptorWith([
        { name: "score", scorer: "graderA", scoreType: "numeric" },
        { name: "score", scorer: "graderB", scoreType: "numeric" },
      ])
    );
    expect(reg.byColId.get("score__graderA__score")?.variable).toBe(
      "graderA.score"
    );
    expect(reg.byColId.get("score__graderB__score")?.variable).toBe(
      "graderB.score"
    );
  });

  it("uses the bare name when the score name equals its scorer", () => {
    const reg = buildSampleFilterSpecRegistry(
      descriptorWith([{ name: "match", scorer: "match", scoreType: "numeric" }])
    );
    expect(reg.byColId.get("score__match__match")?.variable).toBe("match");
  });
});

describe("samplesOperatorsForKind", () => {
  it("narrows to the round-trippable sets", () => {
    expect(samplesOperatorsForKind("string")).toEqual([
      "contains",
      "does not contain",
      "starts with",
      "ends with",
      "=",
      "!=",
      "is blank",
      "is not blank",
    ]);
    expect(samplesOperatorsForKind("number")).toEqual([
      "=",
      "!=",
      "<",
      "<=",
      ">",
      ">=",
      "between",
      "is blank",
      "is not blank",
    ]);
  });
});
