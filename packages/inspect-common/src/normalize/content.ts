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

/** A raw chat message with its content items normalized (see above).
 *  Identity-preserving on clean input. */
export const normalizeMessageContent = (message: unknown): unknown => {
  if (!isRecord(message) || !Array.isArray(message["content"])) {
    return message;
  }
  const items = message["content"] as unknown[];
  const normalized = items.map(normalizeToolUse);
  return normalized.every((item, i) => item === items[i])
    ? message
    : { ...message, content: normalized };
};

/** `normalizeMessageContent` over a raw message list; anything that isn't a
 *  list passes through. Identity-preserving on clean input. */
export const normalizeMessagesContent = (raw: unknown): unknown => {
  if (!Array.isArray(raw)) return raw;
  const messages = raw as unknown[];
  const normalized = messages.map(normalizeMessageContent);
  return normalized.every((message, i) => message === messages[i])
    ? raw
    : normalized;
};
