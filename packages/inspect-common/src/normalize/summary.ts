import { isRecord } from "@tsmono/util";

import type {
  ChatMessage,
  Content,
  EvalSampleSummary,
  ModelFallback,
  ModelUsage,
  Score,
} from "../types";

import { normalizeModelUsage } from "./events";

/**
 * Normalize a raw model-usage map (model name → ModelUsage): token defaults
 * filled per entry, non-record entries dropped, non-record input becomes {}.
 * Identity-preserving on clean input.
 */
export const normalizeModelUsageMap = (
  raw: unknown
): Record<string, ModelUsage> => {
  if (!isRecord(raw)) {
    return {};
  }
  let changed = false;
  const usage: Record<string, ModelUsage> = {};
  for (const [model, entry] of Object.entries(raw)) {
    const normalized = normalizeModelUsage(entry);
    if (normalized === undefined) {
      changed = true;
      continue;
    }
    if (normalized !== entry) changed = true;
    usage[model] = normalized;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): every entry round-tripped unchanged, so raw already satisfies the type
  return changed ? usage : (raw as Record<string, ModelUsage>);
};

const isContent = (value: unknown): value is Content =>
  isRecord(value) && typeof value["type"] === "string";

// `role` is not checked: every pydantic message subclass defaults it, so its
// absence is legal wire data; only the content shape the readers walk is.
const isChatMessage = (value: unknown): value is ChatMessage =>
  isRecord(value) &&
  (typeof value["content"] === "string" ||
    (Array.isArray(value["content"]) &&
      (value["content"] as unknown[]).every(isContent)));

const normalizeInputMessage = (raw: unknown): ChatMessage | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }
  const content = raw["content"];
  if (Array.isArray(content)) {
    const kept = (content as unknown[]).filter(isContent);
    const message =
      kept.length === content.length ? raw : { ...raw, content: kept };
    return isChatMessage(message) ? message : undefined;
  }
  return isChatMessage(raw) ? raw : undefined;
};

/**
 * Normalize a raw sample input: a string passes through; a message list
 * drops entries pydantic would refuse (non-records, content that is neither
 * a string nor a list of typed content items); anything else becomes "".
 * Identity-preserving on clean input.
 */
export const normalizeSampleInput = (raw: unknown): string | ChatMessage[] => {
  if (typeof raw === "string") {
    return raw;
  }
  if (!Array.isArray(raw)) {
    return "";
  }
  const entries = raw as unknown[];
  if (entries.every(isChatMessage)) {
    return entries;
  }
  const messages: ChatMessage[] = [];
  for (const entry of entries) {
    const message = normalizeInputMessage(entry);
    if (message !== undefined) messages.push(message);
  }
  return messages;
};

// A score without a value is not a score — pydantic has no default for it.
const isScore = (value: unknown): value is Score =>
  isRecord(value) && value["value"] !== undefined;

const isScoreMap = (value: unknown): value is Record<string, Score> =>
  isRecord(value) && Object.values(value).every(isScore);

/**
 * Normalize a raw sample scores map (scorer name → Score): non-record and
 * value-less entries drop; a non-record map becomes null, the "unscored"
 * value. Identity-preserving on clean input.
 */
export const normalizeSampleScores = (
  raw: unknown
): Record<string, Score> | null => {
  if (!isRecord(raw)) {
    return null;
  }
  if (isScoreMap(raw)) {
    return raw;
  }
  const scores: Record<string, Score> = {};
  for (const [name, score] of Object.entries(raw)) {
    if (isScore(score)) scores[name] = score;
  }
  return scores;
};

const isModelFallback = (value: unknown): value is ModelFallback =>
  isRecord(value) &&
  typeof value["model"] === "string" &&
  typeof value["fallback_model"] === "string" &&
  typeof value["count"] === "number";

/**
 * Normalize a raw model-fallbacks rollup: `count` defaults to 1 the way
 * pydantic fills it; entries without both model names are dropped (pydantic
 * would refuse them); a non-array becomes null, the "no fallbacks" value.
 * Identity-preserving on clean input.
 */
export const normalizeModelFallbacks = (
  raw: unknown
): ModelFallback[] | null => {
  if (!Array.isArray(raw)) {
    return null;
  }
  const entries = raw as unknown[];
  if (entries.every(isModelFallback)) {
    return entries;
  }
  const fallbacks: ModelFallback[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const filled =
      typeof entry["count"] === "number" ? entry : { ...entry, count: 1 };
    if (isModelFallback(filled)) fallbacks.push(filled);
  }
  return fallbacks;
};

/**
 * Normalize one raw sample summary (summaries.json, journal summaries, the
 * pending-samples buffer): fill required-by-type fields that pydantic
 * defaults at read time but old writers omit. Returns undefined for entries
 * that aren't object-shaped at all — callers drop those. Current-format
 * input passes through identity-preserved.
 */
export const normalizeSampleSummary = (
  raw: unknown
): EvalSampleSummary | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }
  // id/epoch have no pydantic default — a row missing them would refuse to
  // parse upstream, so it drops here rather than passing through as a lie.
  if (typeof raw["id"] !== "string" && typeof raw["id"] !== "number") {
    return undefined;
  }
  if (typeof raw["epoch"] !== "number") {
    return undefined;
  }
  let fixes: Record<string, unknown> | undefined;
  const fix = (field: string, value: unknown) => {
    fixes ??= {};
    fixes[field] = value;
  };

  const input = normalizeSampleInput(raw["input"]);
  if (input !== raw["input"]) fix("input", input);
  if (typeof raw["target"] !== "string" && !Array.isArray(raw["target"])) {
    fix("target", "");
  }
  const scores = normalizeSampleScores(raw["scores"]);
  if (scores !== raw["scores"]) fix("scores", scores);
  if (!isRecord(raw["metadata"])) fix("metadata", {});
  // Usage entries carry their own required-with-default token fields, read
  // unguarded by the tokens column — fill inside, not just the map.
  for (const field of ["model_usage", "role_usage"]) {
    const usage = normalizeModelUsageMap(raw[field]);
    if (usage !== raw[field]) fix(field, usage);
  }
  // Deliberate divergence from pydantic's `completed: bool = False`: an
  // absent `completed` means a pre-field-era log whose summaries are all
  // settled, and the viewer has always read absence as completed
  // (`completed === false` takes the running path; `filters.ts` used
  // `?? true`). Live paths (pending-samples buffer, journal rows from
  // current writers) set the field explicitly, so only vintage settled
  // rows hit this fill.
  if (typeof raw["completed"] !== "boolean") fix("completed", true);
  // Absent stays absent (the field is optional); anything present must be a
  // clean rollup or null.
  if (raw["model_fallbacks"] !== undefined && raw["model_fallbacks"] !== null) {
    const fallbacks = normalizeModelFallbacks(raw["model_fallbacks"]);
    if (fallbacks !== raw["model_fallbacks"]) fix("model_fallbacks", fallbacks);
  }

  const summary = fixes ? { ...raw, ...fixes } : raw;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): required fields are filled above; the rest is wire data TypeScript can't verify
  return summary as unknown as EvalSampleSummary;
};

/**
 * Normalize a raw summary array. Non-arrays become empty; non-object
 * entries are dropped. Current-format input passes through
 * identity-preserved — no allocation at all.
 */
export const normalizeSampleSummaries = (raw: unknown): EvalSampleSummary[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  let changed = false;
  const summaries: EvalSampleSummary[] = [];
  for (const entry of raw as unknown[]) {
    const summary = normalizeSampleSummary(entry);
    if (summary === undefined) {
      changed = true;
    } else {
      if (summary !== entry) changed = true;
      summaries.push(summary);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): every entry round-tripped through normalizeSampleSummary unchanged, so raw already satisfies the type
  return changed ? summaries : (raw as EvalSampleSummary[]);
};
