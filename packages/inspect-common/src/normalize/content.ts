import { isRecord } from "@tsmono/util";

// ContentToolUse `arguments` and `result` were JSON values in logs written by
// inspect_ai 0.3.123–0.3.125 and are strings since 0.3.126. Current
// inspect_ai refuses the old shape; the viewer keeps the content and stores
// each value's JSON text, so readers can treat both as the declared strings.
const jsonText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : value == null
      ? ""
      : JSON.stringify(value);

const normalizeToolUse = (item: unknown): unknown => {
  if (!isRecord(item) || item["type"] !== "tool_use") return item;
  const args = jsonText(item["arguments"]);
  const result = jsonText(item["result"]);
  return args === item["arguments"] && result === item["result"]
    ? item
    : { ...item, arguments: args, result };
};

// Runs on every message and model output of every sample, and clean input is
// the common case, so the copy is made only once an item changes.
const mapIfChanged = (
  items: readonly unknown[],
  fn: (item: unknown) => unknown
): readonly unknown[] => {
  let out: unknown[] | undefined;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const next = fn(item);
    if (out) {
      out.push(next);
    } else if (next !== item) {
      out = items.slice(0, i);
      out.push(next);
    }
  }
  return out ?? items;
};

/** A raw chat message with its content items normalized (see above).
 *  Identity-preserving on clean input. */
export const normalizeMessageContent = (message: unknown): unknown => {
  if (!isRecord(message) || !Array.isArray(message["content"])) {
    return message;
  }
  const items = message["content"] as unknown[];
  const content = mapIfChanged(items, normalizeToolUse);
  return content === items ? message : { ...message, content };
};

/** `normalizeMessageContent` over a raw message list; anything that isn't a
 *  list passes through. Identity-preserving on clean input. */
export const normalizeMessagesContent = (raw: unknown): unknown =>
  Array.isArray(raw) ? mapIfChanged(raw, normalizeMessageContent) : raw;
