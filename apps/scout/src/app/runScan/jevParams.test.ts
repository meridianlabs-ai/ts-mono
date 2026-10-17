import { describe, expect, it } from "vitest";

import {
  defaultJevParams,
  jevScannerParams,
  JevScannerParamsValue,
} from "./jevParams";

const form = (
  partial: Partial<JevScannerParamsValue>
): JevScannerParamsValue => ({
  ...defaultJevParams,
  question: "Did the agent delete files?",
  ...partial,
});

describe("jevScannerParams", () => {
  it("builds boolean params with threshold, criteria and options", () => {
    expect(
      jevScannerParams(
        form({
          threshold: "0.7",
          trueCriterion: "files were deleted",
          references: "all",
          redact: "off",
          model: " typesafe/jev-1.13.0 ",
        })
      )
    ).toEqual({
      ok: true,
      params: {
        question: "Did the agent delete files?",
        answer: "boolean",
        threshold: 0.7,
        criteria: { true: "files were deleted" },
        references: "all",
        redact: false,
        model: "typesafe/jev-1.13.0",
        preprocessor: {
          exclude_system: true,
          exclude_reasoning: false,
          exclude_tool_usage: false,
        },
      },
    });
  });

  it("omits optional params left empty", () => {
    const result = jevScannerParams(form({}));
    expect(result.ok && result.params).toMatchObject({
      references: true,
      redact: "keys",
    });
    expect(result.ok && Object.keys(result.params)).not.toContain("criteria");
    expect(result.ok && Object.keys(result.params)).not.toContain("model");
  });

  it("parses labels with optional descriptions", () => {
    const result = jevScannerParams(
      form({
        answerType: "labels",
        labels: "Satisfied: accepted the work\n\n Corrected \nFrustrated:",
      })
    );
    expect(result.ok && result.params).toMatchObject({
      answer: ["Satisfied", "Corrected", "Frustrated"],
      criteria: { Satisfied: "accepted the work" },
    });
  });

  it("sends rubric levels for numeric answers", () => {
    const result = jevScannerParams(
      form({ answerType: "numeric", rubric: "none\nsome\nlots" })
    );
    expect(result.ok && result.params).toMatchObject({
      answer: "numeric",
      rubric: ["none", "some", "lots"],
    });
  });

  it.each<[string, Partial<JevScannerParamsValue>, string]>([
    ["empty question", { question: "  " }, "Enter a question"],
    ["threshold above 1", { threshold: "1.5" }, "between 0 and 1"],
    ["empty threshold", { threshold: "" }, "between 0 and 1"],
    ["one label", { answerType: "labels", labels: "Only" }, "between 2"],
    ["duplicate label", { answerType: "labels", labels: "A\nA: x" }, "twice"],
    ["missing label", { answerType: "labels", labels: "A\n: x" }, "missing"],
    ["one rubric level", { answerType: "numeric", rubric: "x" }, "rubric"],
  ])("rejects %s", (_name, partial, error) => {
    const result = jevScannerParams(form(partial));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(error);
  });
});
