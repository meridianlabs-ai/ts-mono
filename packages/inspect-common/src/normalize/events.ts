import { isRecord } from "@tsmono/util";

import type { Event, ModelOutput, ModelUsage } from "../types";

/**
 * Fill pydantic token defaults on one raw ModelUsage record
 * (`input_tokens`/`output_tokens`/`total_tokens` default to 0 upstream).
 * Returns undefined for non-records — pydantic would refuse them outright.
 * Identity-preserving on clean input.
 */
export const normalizeModelUsage = (raw: unknown): ModelUsage | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }
  const fixes: Record<string, unknown> = {};
  for (const field of ["input_tokens", "output_tokens", "total_tokens"]) {
    if (typeof raw[field] !== "number") fixes[field] = 0;
  }
  const out = Object.keys(fixes).length > 0 ? { ...raw, ...fixes } : raw;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): token defaults are filled above; the rest is what the writer serialized
  return out as ModelUsage;
};

/**
 * ChatCompletionChoice rows: `stop_reason` defaults to "unknown" upstream.
 * Rows that aren't records are dropped — pydantic would refuse them.
 * Identity-preserving when nothing needs filling.
 */
const normalizeChoices = (raw: unknown): unknown[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  let changed = false;
  const choices: unknown[] = [];
  for (const choice of raw as unknown[]) {
    if (!isRecord(choice)) {
      changed = true;
      continue;
    }
    if (typeof choice["stop_reason"] !== "string") {
      changed = true;
      choices.push({ ...choice, stop_reason: "unknown" });
    } else {
      choices.push(choice);
    }
  }
  return changed ? choices : raw;
};

/**
 * The ModelOutput pydantic constructs when a field is absent
 * (`output: ModelOutput = Field(default_factory=ModelOutput)`).
 */
export const defaultModelOutput = (): ModelOutput => ({
  model: "",
  choices: [],
  completion: "",
});

/**
 * Fill pydantic-level defaults on a raw ModelOutput. Old files (or crafted
 * logs) can omit any of these; pydantic fills them at read time on the
 * Python side, so the generated types declare them present.
 */
export const normalizeModelOutput = (raw: unknown): ModelOutput => {
  if (!isRecord(raw)) {
    return defaultModelOutput();
  }
  const fixes: Record<string, unknown> = {};
  if (typeof raw["model"] !== "string") fixes["model"] = "";
  {
    const choices = normalizeChoices(raw["choices"]);
    if (choices !== raw["choices"]) fixes["choices"] = choices;
  }
  if (typeof raw["completion"] !== "string") fixes["completion"] = "";
  const usage = raw["usage"];
  if (isRecord(usage)) {
    const normalized = normalizeModelUsage(usage);
    if (normalized !== usage) fixes["usage"] = normalized;
  }
  const out = Object.keys(fixes).length > 0 ? { ...raw, ...fixes } : raw;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): structural defaults are filled above; the rest is what the writer serialized
  return out as ModelOutput;
};

const normalizeScore = (raw: unknown): Record<string, unknown> => {
  if (!isRecord(raw)) {
    return { value: "", history: [] };
  }
  const fixes: Record<string, unknown> = {};
  if (raw["value"] === undefined) fixes["value"] = "";
  if (!Array.isArray(raw["history"])) fixes["history"] = [];
  return Object.keys(fixes).length > 0 ? { ...raw, ...fixes } : raw;
};

/**
 * ScoreEdit: `value` and `metadata` default to the "UNCHANGED" sentinel
 * upstream. Neither admits null, so an explicit wire null fills like an
 * absence. A non-record edit is degradation — pydantic would refuse it.
 */
const normalizeScoreEdit = (raw: unknown): Record<string, unknown> => {
  if (!isRecord(raw)) {
    return { value: "UNCHANGED", metadata: "UNCHANGED" };
  }
  const fixes: Record<string, unknown> = {};
  if (raw["value"] == null) fixes["value"] = "UNCHANGED";
  if (raw["metadata"] == null) fixes["metadata"] = "UNCHANGED";
  return Object.keys(fixes).length > 0 ? { ...raw, ...fixes } : raw;
};

/**
 * JsonChange rows: `value` and `replaced` default to None upstream, so an
 * absent field reads as null. Rows that aren't records are dropped —
 * pydantic would refuse them. Identity-preserving when nothing needs filling.
 */
const normalizeJsonChanges = (raw: unknown): unknown[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  let changed = false;
  const changes: unknown[] = [];
  for (const change of raw as unknown[]) {
    if (!isRecord(change)) {
      changed = true;
      continue;
    }
    const fixes: Record<string, unknown> = {};
    if (change["value"] === undefined) fixes["value"] = null;
    if (change["replaced"] === undefined) fixes["replaced"] = null;
    if (Object.keys(fixes).length > 0) {
      changed = true;
      changes.push({ ...change, ...fixes });
    } else {
      changes.push(change);
    }
  }
  return changed ? changes : raw;
};

/**
 * Per-event-type defaults for required fields pydantic defaults at read
 * time. Returns undefined when nothing needs filling (the hot path for
 * current-format logs — no allocation).
 */
const eventFixes = (
  raw: Record<string, unknown>
): Record<string, unknown> | undefined => {
  let fixes: Record<string, unknown> | undefined;
  const fix = (field: string, value: unknown) => {
    fixes ??= {};
    fixes[field] = value;
  };

  // BaseEvent: `working_start` has a default_factory upstream, so it is
  // required-by-type but absent in logs written before it existed (pre-2025).
  if (typeof raw["working_start"] !== "number") fix("working_start", 0);
  if (typeof raw["timestamp"] !== "string") fix("timestamp", "");

  switch (raw["event"]) {
    case "model":
      if (typeof raw["model"] !== "string") fix("model", "");
      if (!isRecord(raw["config"])) fix("config", {});
      if (!Array.isArray(raw["tools"])) fix("tools", []);
      if (!Array.isArray(raw["input"])) fix("input", []);
      // == null: these fields' types don't admit null, so an explicit wire
      // null must fill like an absence (same below for tool/compaction).
      if (raw["tool_choice"] == null) fix("tool_choice", "none");
      {
        const output = normalizeModelOutput(raw["output"]);
        if (output !== raw["output"]) fix("output", output);
      }
      break;
    case "error":
      if (!isRecord(raw["error"]))
        fix("error", { message: "", traceback: "", traceback_ansi: "" });
      break;
    case "logger":
      if (!isRecord(raw["message"]))
        fix("message", {
          level: "info",
          message: "",
          created: 0,
          filename: "unknown",
          module: "unknown",
          lineno: 0,
        });
      break;
    case "score":
      // "" because Score.value doesn't admit null; pydantic would reject a
      // score-less (or value-less) ScoreEvent outright, so this is
      // degradation, not parity.
      {
        const score = normalizeScore(raw["score"]);
        if (score !== raw["score"]) fix("score", score);
      }
      if (typeof raw["intermediate"] !== "boolean") fix("intermediate", false);
      break;
    case "score_edit":
      if (typeof raw["score_name"] !== "string") fix("score_name", "");
      {
        const edit = normalizeScoreEdit(raw["edit"]);
        if (edit !== raw["edit"]) fix("edit", edit);
      }
      break;
    case "state":
    case "store":
      {
        const changes = normalizeJsonChanges(raw["changes"]);
        if (changes !== raw["changes"]) fix("changes", changes);
      }
      break;
    case "tool":
      if (typeof raw["id"] !== "string") fix("id", "");
      if (typeof raw["function"] !== "string") fix("function", "");
      if (!isRecord(raw["arguments"])) fix("arguments", {});
      if (raw["result"] == null) fix("result", "");
      if (raw["type"] == null) fix("type", "function");
      {
        // Nested events normalize recursively, like pydantic's nested models.
        const nested = normalizeEvents(raw["events"]);
        if (nested !== raw["events"]) fix("events", nested);
      }
      break;
    case "subtask":
      if (typeof raw["name"] !== "string") fix("name", "");
      if (!isRecord(raw["input"])) fix("input", {});
      if (raw["result"] === undefined) fix("result", null);
      {
        const nested = normalizeEvents(raw["events"]);
        if (nested !== raw["events"]) fix("events", nested);
      }
      break;
    case "input":
      if (typeof raw["input"] !== "string") fix("input", "");
      if (typeof raw["input_ansi"] !== "string") fix("input_ansi", "");
      break;
    case "sample_init":
      if (!isRecord(raw["sample"])) fix("sample", {});
      if (raw["state"] === undefined) fix("state", null);
      break;
    case "info":
      if (raw["data"] === undefined) fix("data", null);
      break;
    case "compaction":
      if (raw["type"] == null) fix("type", "summary");
      break;
    case "span_begin":
      if (typeof raw["id"] !== "string") fix("id", "");
      if (typeof raw["name"] !== "string") fix("name", "");
      break;
    case "span_end":
      if (typeof raw["id"] !== "string") fix("id", "");
      break;
    default:
      // Unknown/future event kinds pass through untouched beyond the base
      // fields — the viewer degrades gracefully rather than dropping them.
      break;
  }
  return fixes;
};

/**
 * Normalize one raw event: fill required-by-type fields that pydantic
 * defaults at read time but old or crafted logs omit. Returns undefined for
 * entries that aren't event-shaped at all (not an object, no `event` tag) —
 * callers drop those, matching the Python reader which would refuse the file.
 */
export const normalizeEvent = (raw: unknown): Event | undefined => {
  if (!isRecord(raw) || typeof raw["event"] !== "string") {
    return undefined;
  }
  const fixes = eventFixes(raw);
  const event = fixes ? { ...raw, ...fixes } : raw;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): the fills above guarantee the structure downstream depends on; the rest is untyped wire data
  return event as unknown as Event;
};

/**
 * Normalize a raw `events` array (eval-log samples, scout transcripts).
 * Non-arrays become empty; non-event entries are dropped. Current-format
 * input passes through identity-preserved — no allocation at all.
 */
export const normalizeEvents = (raw: unknown): Event[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  let changed = false;
  const events: Event[] = [];
  for (const entry of raw as unknown[]) {
    const event = normalizeEvent(entry);
    if (event === undefined) {
      changed = true;
    } else {
      if (event !== entry) changed = true;
      events.push(event);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): every entry round-tripped through normalizeEvent unchanged, so raw already satisfies Event[]
  return changed ? events : (raw as Event[]);
};
