import { getOwn, isRecord } from "@tsmono/util";

const CONTENT_PROTOCOL = "tc://";
const ATTACHMENT_PROTOCOL = "attachment://";

type Resolve = (value: unknown) => unknown;

const resolveString = (
  value: string,
  attachments: Readonly<Record<string, unknown>>,
  onFailedResolve?: (attachmentId: string) => void
): string => {
  // Rewrite the legacy tc:// protocol before resolving
  const ref = value.startsWith(CONTENT_PROTOCOL)
    ? value.replace(CONTENT_PROTOCOL, ATTACHMENT_PROTOCOL)
    : value;
  if (!ref.startsWith(ATTACHMENT_PROTOCOL)) {
    return value;
  }
  const attachmentId = ref.slice(ATTACHMENT_PROTOCOL.length);
  // Own-key read: the id is log-authored, and "constructor" must be a miss
  // rather than the inherited builtin.
  const attachment = getOwn(attachments, attachmentId);
  if (typeof attachment !== "string") {
    onFailedResolve?.(attachmentId);
    // A miss keeps the original (un-rewritten) string
    return value;
  }
  return attachment;
};

// Unchanged values keep their identity so downstream React re-renders
// (and reference-equality caches) aren't invalidated by the walk
const mapArray = (value: unknown[], resolve: Resolve): unknown[] => {
  let hasChanged = false;
  const resolved: unknown[] = [];
  for (const v of value) {
    const r = resolve(v);
    if (r !== v) hasChanged = true;
    resolved.push(r);
  }
  return hasChanged ? resolved : value;
};

const mapFields = (
  value: object,
  resolve: (value: unknown, key: string) => unknown
): object => {
  let hasChanged = false;
  const resolved: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const r = resolve(v, key);
    resolved[key] = r;
    if (r !== v) hasChanged = true;
  }
  return hasChanged ? resolved : value;
};

const resolveValue = (
  value: unknown,
  attachments: Readonly<Record<string, unknown>>,
  onFailedResolve?: (attachmentId: string) => void
): unknown => {
  if (typeof value === "string") {
    return resolveString(value, attachments, onFailedResolve);
  }

  const resolve: Resolve = (v) => resolveValue(v, attachments, onFailedResolve);

  if (Array.isArray(value)) {
    return mapArray(value, resolve);
  }

  // Recurse into plain objects, but not special object types like Date/RegExp
  if (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  ) {
    return mapFields(value, resolve);
  }

  return value;
};

// Tool result text stays as written: inspect_ai's writer condenses only the
// media in a tool result (walk_tool_result), so its reader resolves only
// those and a literal "attachment://..." in the text is the tool's output.
const resolveToolResult = (result: unknown, resolve: Resolve): unknown => {
  const resolveBlock: Resolve = (block) =>
    isRecord(block) && block.type === "text" ? block : resolve(block);
  if (typeof result === "string") {
    return result;
  }
  return Array.isArray(result)
    ? mapArray(result, resolveBlock)
    : resolveBlock(result);
};

const resolveEventValue = (value: unknown, resolve: Resolve): unknown => {
  if (Array.isArray(value)) {
    return mapArray(value, (event) => resolveEventValue(event, resolve));
  }
  if (!isRecord(value)) {
    return resolve(value);
  }
  const nestedEvents: Resolve = (events) => resolveEventValue(events, resolve);
  switch (value.event) {
    case "tool":
      return mapFields(value, (v, key) =>
        key === "result"
          ? resolveToolResult(v, resolve)
          : key === "events"
            ? nestedEvents(v)
            : resolve(v)
      );
    case "subtask":
      return mapFields(value, (v, key) =>
        key === "events" ? nestedEvents(v) : resolve(v)
      );
    default:
      return resolve(value);
  }
};

// TypeScript can't express "same type, strings substituted", so the walks
// work in `unknown` and this is where the shape is handed back.
const withShape = <T>(value: T, walk: Resolve): T =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape-preserving walk: see above
  walk(value) as T;

/**
 * Walks a value replacing attachment:// (and legacy tc://) references with
 * their content, leaving the value's shape untouched.
 * Attachment values are untrusted; only own string entries resolve.
 */
export const resolveAttachments = <T>(
  value: T,
  attachments: Readonly<Record<string, unknown>>,
  onFailedResolve?: (attachmentId: string) => void
): T => withShape(value, (v) => resolveValue(v, attachments, onFailedResolve));

/**
 * `resolveAttachments` for an event or a list of events, matching
 * inspect_ai's reader: tool result text is left as written, since the
 * writer never puts references there.
 */
export const resolveEventAttachments = <T>(
  events: T,
  attachments: Readonly<Record<string, unknown>>,
  onFailedResolve?: (attachmentId: string) => void
): T =>
  withShape(events, (v) =>
    resolveEventValue(v, (field) =>
      resolveValue(field, attachments, onFailedResolve)
    )
  );
