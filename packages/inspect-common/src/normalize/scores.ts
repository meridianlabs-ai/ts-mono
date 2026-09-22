import { isRecord } from "@tsmono/util";

// Drop unusable whole scores, not valid null dictionary leaves. A whole null
// might be a legacy serialized NaN, but the value alone cannot establish that.
// This intentionally omits the entry's explanation and other context from the
// normalized view too; the original input remains available unchanged.
export const normalizeSampleScores = (
  raw: unknown
): Record<string, unknown> | null => {
  if (!isRecord(raw)) return null;
  const entries = Object.entries(raw);
  const kept = entries.filter(
    ([, score]) => isRecord(score) && score["value"] != null
  );
  return kept.length === entries.length ? raw : Object.fromEntries(kept);
};
