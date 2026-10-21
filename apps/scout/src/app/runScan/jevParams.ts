export const kJevAnswerTypes = ["boolean", "labels", "numeric"] as const;
export type JevAnswerType = (typeof kJevAnswerTypes)[number];

export const kJevReferences = ["best", "all", "none"] as const;
export type JevReferences = (typeof kJevReferences)[number];

export const kJevRedact = ["keys", "all", "off"] as const;
export type JevRedact = (typeof kJevRedact)[number];

export interface JevScannerParamsValue {
  question: string;
  answerType: JevAnswerType;
  /** Boolean answers: what "yes" and "no" mean (optional). */
  trueCriterion: string;
  falseCriterion: string;
  /** Label answers: one label per line, optionally `Label: description`. */
  labels: string;
  /** Numeric answers: one score level per line, lowest first. */
  rubric: string;
  threshold: string;
  references: JevReferences;
  redact: JevRedact;
  /** Empty uses the scanner's default Jev model. */
  model: string;
  excludeSystem: boolean;
  excludeReasoning: boolean;
  excludeToolUsage: boolean;
}

export const defaultJevParams: JevScannerParamsValue = {
  question: "",
  answerType: "boolean",
  trueCriterion: "",
  falseCriterion: "",
  labels: "",
  rubric: "",
  threshold: "0.5",
  references: "best",
  redact: "keys",
  model: "",
  excludeSystem: true,
  excludeReasoning: false,
  excludeToolUsage: false,
};

export type ScannerParamsResult =
  { ok: true; params: Record<string, unknown> } | { ok: false; error: string };

const kMaxLabels = 255;
const kMinRubricLevels = 2;
const kMaxRubricLevels = 10;

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/** Find a member of `options` equal to `value` (for narrowing select values). */
export const findOption = <T extends string>(
  options: readonly T[],
  value: string,
  fallback: T
): T => options.find((option) => option === value) ?? fallback;

/**
 * Turn the Jev form into `jev_scanner()` params, or explain what is missing.
 * The scanner validates again when the scan starts; this catches the common
 * mistakes before a scan is launched.
 */
export const jevScannerParams = (
  value: JevScannerParamsValue
): ScannerParamsResult => {
  const question = value.question.trim();
  if (!question) {
    return { ok: false, error: "Enter a question." };
  }

  const params: Record<string, unknown> = {
    question,
    references:
      value.references === "best"
        ? true
        : value.references === "all"
          ? "all"
          : false,
    redact: value.redact === "off" ? false : value.redact,
    preprocessor: {
      exclude_system: value.excludeSystem,
      exclude_reasoning: value.excludeReasoning,
      exclude_tool_usage: value.excludeToolUsage,
    },
  };
  const model = value.model.trim();
  if (model) {
    params.model = model;
  }

  switch (value.answerType) {
    case "boolean": {
      const threshold = Number(value.threshold);
      if (
        value.threshold.trim() === "" ||
        !(threshold >= 0 && threshold <= 1)
      ) {
        return { ok: false, error: "Threshold must be between 0 and 1." };
      }
      params.answer = "boolean";
      params.threshold = threshold;
      const criteria: Record<string, string> = {};
      if (value.trueCriterion.trim()) {
        criteria.true = value.trueCriterion.trim();
      }
      if (value.falseCriterion.trim()) {
        criteria.false = value.falseCriterion.trim();
      }
      if (Object.keys(criteria).length > 0) {
        params.criteria = criteria;
      }
      return { ok: true, params };
    }
    case "labels": {
      const labels: string[] = [];
      const criteria: Record<string, string> = {};
      for (const line of lines(value.labels)) {
        const separator = line.indexOf(":");
        const label = (
          separator === -1 ? line : line.slice(0, separator)
        ).trim();
        const description =
          separator === -1 ? "" : line.slice(separator + 1).trim();
        if (!label) {
          return { ok: false, error: `Label missing before ":" in "${line}".` };
        }
        if (labels.includes(label)) {
          return { ok: false, error: `Label "${label}" is listed twice.` };
        }
        labels.push(label);
        if (description) {
          criteria[label] = description;
        }
      }
      if (labels.length < 2 || labels.length > kMaxLabels) {
        return {
          ok: false,
          error: `Enter between 2 and ${kMaxLabels} labels, one per line.`,
        };
      }
      params.answer = labels;
      if (Object.keys(criteria).length > 0) {
        params.criteria = criteria;
      }
      return { ok: true, params };
    }
    case "numeric": {
      const rubric = lines(value.rubric);
      if (
        rubric.length < kMinRubricLevels ||
        rubric.length > kMaxRubricLevels
      ) {
        return {
          ok: false,
          error: `Enter between ${kMinRubricLevels} and ${kMaxRubricLevels} rubric levels, one per line, lowest first.`,
        };
      }
      params.answer = "numeric";
      params.rubric = rubric;
      return { ok: true, params };
    }
  }
};
