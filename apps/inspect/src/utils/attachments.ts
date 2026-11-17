import { getOwn, isRecord } from "@tsmono/util";

const CONTENT_PROTOCOL = "tc://";
const ATTACHMENT_PROTOCOL = "attachment://";

type ResolveRef = (value: string) => string;
type Walk = (value: unknown, resolve: ResolveRef) => unknown;

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
const mapArray = (
  value: unknown[],
  walk: (value: unknown) => unknown
): unknown[] => {
  let hasChanged = false;
  const resolved: unknown[] = [];
  for (const v of value) {
    const r = walk(v);
    if (r !== v) hasChanged = true;
    resolved.push(r);
  }
  return hasChanged ? resolved : value;
};

const mapFields = (
  value: Record<string, unknown>,
  walk: (value: unknown, key: string) => unknown
): Record<string, unknown> => {
  let hasChanged = false;
  const resolved: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const r = walk(v, key);
    resolved[key] = r;
    if (r !== v) hasChanged = true;
  }
  return hasChanged ? resolved : value;
};

const str: Walk = (value, resolve) =>
  typeof value === "string" ? resolve(value) : value;

const json: Walk = (value, resolve) => {
  if (typeof value === "string") {
    return resolve(value);
  }
  if (Array.isArray(value)) {
    return mapArray(value, (v) => json(v, resolve));
  }
  if (isRecord(value)) {
    return mapFields(value, (v) => json(v, resolve));
  }
  return value;
};

const listOf =
  (walk: Walk): Walk =>
  (value, resolve) =>
    Array.isArray(value) ? mapArray(value, (v) => walk(v, resolve)) : value;

// Walks the named fields of an object; every other field stays as stored.
const fields =
  (walks: Readonly<Record<string, Walk>>): Walk =>
  (value, resolve) =>
    isRecord(value)
      ? mapFields(value, (v, key) => {
          const walk = getOwn(walks, key);
          return walk ? walk(v, resolve) : v;
        })
      : value;

// Picks the walk for an object by its discriminator; an object of any other
// kind stays as stored.
const byKind =
  (discriminator: string, walks: Readonly<Record<string, Walk>>): Walk =>
  (value, resolve) => {
    const kind = isRecord(value) ? value[discriminator] : undefined;
    const walk = typeof kind === "string" ? getOwn(walks, kind) : undefined;
    return walk ? walk(value, resolve) : value;
  };

// The positions inspect_ai resolves attachment refs in, each named after its
// walker in src/inspect_ai/log/_condense.py. These are the positions its
// writer condenses; everything else is plain text and is shown as stored.

// walk_media_content
const mediaWalks = {
  image: fields({ image: str }),
  audio: fields({ audio: str }),
  video: fields({ video: str }),
  document: fields({ document: str }),
};

// walk_content
const content = byKind("type", {
  ...mediaWalks,
  text: fields({ text: str }),
  reasoning: fields({ reasoning: str }),
  tool_use: fields({ arguments: json, result: json, error: str }),
  data: fields({ data: json }),
});

// walk_tool_call
const toolCall = fields({
  arguments: json,
  view: fields({ content: str }),
});

// walk_chat_message: string content alone, or the content blocks and an
// assistant's tool calls
const textMessage = fields({ content: str });
const blocksMessage = fields({ content: listOf(content) });
const assistantBlocksMessage = fields({
  content: listOf(content),
  tool_calls: listOf(toolCall),
});
const message: Walk = (value, resolve) => {
  if (!isRecord(value)) {
    return value;
  }
  const walk =
    typeof value.content === "string"
      ? textMessage
      : value.role === "assistant"
        ? assistantBlocksMessage
        : blocksMessage;
  return walk(value, resolve);
};

// walk_chat_messages
const messages = listOf(message);

// walk_input: a string input is plain text
const sampleInput: Walk = (value, resolve) =>
  typeof value === "string" ? value : messages(value, resolve);

// walk_tool_result: media only; result text is the tool's output
const toolResultBlock = byKind("type", mediaWalks);
const toolResult: Walk = (value, resolve) =>
  Array.isArray(value)
    ? mapArray(value, (v) => toolResultBlock(v, resolve))
    : toolResultBlock(value, resolve);

// ChatMessage.text
const messageText = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  if (!Array.isArray(value.content)) {
    return undefined;
  }
  return value.content
    .flatMap((c) =>
      isRecord(c) && c.type === "text" && typeof c.text === "string"
        ? [c.text]
        : []
    )
    .join("\n");
};

const firstChoiceText = (output: Record<string, unknown>) => {
  const choices = output.choices;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  return isRecord(first) ? messageText(first.message) : undefined;
};

// walk_model_output with resolve_completion: a completion equal to the first
// choice's text was derived from it (logs from before 0.3.123 rewritten by a
// newer inspect_ai), so it takes the resolved text; any other completion is
// the model's own text.
const modelOutput: Walk = (value, resolve) => {
  const walked = fields({ choices: listOf(fields({ message })) })(
    value,
    resolve
  );
  if (
    !isRecord(value) ||
    !isRecord(walked) ||
    typeof value.completion !== "string" ||
    value.completion !== firstChoiceText(value)
  ) {
    return walked;
  }
  const completion = firstChoiceText(walked);
  return completion === undefined || completion === value.completion
    ? walked
    : { ...walked, completion };
};

// walk_model_call (inspect_ai's "full" mode; its "core" default leaves the
// call condensed)
const modelCall = fields({ request: json, response: json });

// walk_state_json_change
const changes = listOf(fields({ value: json }));

// walk_nested_events: results of nested tool events were never condensed
const nestedToolEvent = fields({
  arguments: json,
  events: (value, resolve) => nestedEvents(value, resolve),
});
const nestedEvent: Walk = (value, resolve) =>
  isRecord(value) && value.event === "tool"
    ? nestedToolEvent(value, resolve)
    : event(value, resolve);
const nestedEvents = listOf(nestedEvent);

// walk_event
const eventWalks: Readonly<Record<string, Walk>> = {
  // walk_sample_init_event, walk_sample: unlike EvalSample.input, a string
  // input here is walked as a JSON value
  sample_init: fields({
    sample: fields({
      input: (value, resolve) =>
        typeof value === "string" ? resolve(value) : messages(value, resolve),
    }),
    state: json,
  }),
  // walk_model_event
  model: fields({
    tools: listOf(fields({ description: str })),
    input: messages,
    output: modelOutput,
    call: modelCall,
  }),
  // walk_state_event, walk_store_event
  state: fields({ changes }),
  store: fields({ changes }),
  // walk_subtask_event
  subtask: fields({ events: nestedEvents }),
  // walk_tool_event
  tool: fields({ arguments: json, result: toolResult, events: nestedEvents }),
  // walk_info_event
  info: fields({ data: json }),
  // walk_communication_event
  communication: fields({
    send: fields({
      record: fields({ content: str }),
      rejected: fields({ reason: str }),
    }),
    data: json,
  }),
  // walk_swarm_event
  swarm: fields({ data: json }),
};

const eventWalk = byKind("event", eventWalks);

// Hoisted: nested events walk back into it
function event(value: unknown, resolve: ResolveRef): unknown {
  return eventWalk(value, resolve);
}

/**
 * Replaces attachment:// (and legacy tc://) references in `value` with their
 * content in the positions inspect_ai resolves, leaving the shape and every
 * other field untouched. Attachment values are untrusted; only own string
 * entries resolve.
 */
export type AttachmentResolver = <T>(
  value: T,
  attachments: Readonly<Record<string, unknown>>,
  onFailedResolve?: (attachmentId: string) => void
) => T;

const resolver =
  (walk: Walk): AttachmentResolver =>
  (value, attachments, onFailedResolve) =>
    // TypeScript can't express "same type, strings substituted", so the
    // walks work in `unknown` and this is where the shape is handed back.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape-preserving walk: see above
    walk(value, (ref) =>
      resolveString(ref, attachments, onFailedResolve)
    ) as typeof value;

const oneOrMany =
  (walk: Walk): Walk =>
  (value, resolve) =>
    Array.isArray(value) ? listOf(walk)(value, resolve) : walk(value, resolve);

/** Resolves an event or a list of events (`walk_events`). */
export const resolveEventAttachments = resolver(oneOrMany(event));

/** Resolves a chat message or a list of them (`walk_chat_messages`). */
export const resolveMessageAttachments = resolver(oneOrMany(message));

/** Resolves an `EvalSample.input`; a string input stays as written. */
export const resolveInputAttachments = resolver(sampleInput);
