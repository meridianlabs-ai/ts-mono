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
  if (!Array.isArray(raw["choices"])) fixes["choices"] = [];
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
      // score-less ScoreEvent outright, so this is degradation, not parity.
      if (!isRecord(raw["score"])) fix("score", { value: "", history: [] });
      if (typeof raw["intermediate"] !== "boolean") fix("intermediate", false);
      break;
    case "state":
    case "store":
      if (!Array.isArray(raw["changes"])) fix("changes", []);
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
