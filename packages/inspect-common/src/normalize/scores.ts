import { isRecord } from "@tsmono/util";

import type { Score } from "../types";

// Drop unusable whole scores, not valid null dictionary leaves. A whole null
// might be a legacy serialized NaN, but the value alone cannot establish that.
// This intentionally omits the entry's explanation and other context from the
// normalized view too; the original input remains available unchanged.
const hasUsableValue = (value: unknown): value is Score =>
  isRecord(value) && value["value"] != null;

const kScoreTextFields = ["answer", "explanation", "reason"] as const;

const hasMalformedContext = (score: Score): boolean =>
  kScoreTextFields.some(
    (field) => score[field] != null && typeof score[field] !== "string"
  ) ||
  (score.metadata != null && !isRecord(score.metadata));

// The context fields are optional, so a malformed one clears to null (their
// "absent" value) rather than costing the score its value.
const clearMalformedContext = (score: Score): Score => {
  const cleared: Score = { ...score };
  for (const field of kScoreTextFields) {
    if (typeof cleared[field] !== "string") cleared[field] = null;
  }
  if (!isRecord(cleared.metadata)) cleared.metadata = null;
  return cleared;
};

const isCleanScoreMap = (
  value: Record<string, unknown>
): value is Record<string, Score> =>
  Object.values(value).every(
    (score) => hasUsableValue(score) && !hasMalformedContext(score)
  );

/**
 * Normalize a raw sample scores map (scorer name → Score): entries without a
 * usable value drop; a non-string `answer`/`explanation`/`reason` or
 * non-record `metadata` clears to null; a non-record map becomes null, the
 * "unscored" value. Identity-preserving on clean input.
 */
export const normalizeSampleScores = (
  raw: unknown
): Record<string, Score> | null => {
  if (!isRecord(raw)) return null;
  if (isCleanScoreMap(raw)) return raw;
  const scores: Record<string, Score> = {};
  for (const [name, score] of Object.entries(raw)) {
    if (!hasUsableValue(score)) continue;
    scores[name] = hasMalformedContext(score)
      ? clearMalformedContext(score)
      : score;
  }
  return scores;
};
