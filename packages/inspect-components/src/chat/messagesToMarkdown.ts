import type {
  ChatMessage,
  Content,
  ContentReasoning,
  ContentText,
  ContentToolUse,
} from "@tsmono/inspect-common/types";

/**
 * Converts selected messages to a Markdown document suitable for reports
 * and other review artifacts. One section per message, titled by role;
 * prose keeps its Markdown, tool calls and results are fenced so they
 * render verbatim. A selected message with nothing to extract still gets
 * its heading so the export never silently shortens (or empties) the
 * selection.
 */
export const messagesToMarkdown = (messages: readonly ChatMessage[]): string =>
  messages.map(messageToMarkdown).join("\n\n---\n\n");

const messageToMarkdown = (message: ChatMessage): string => {
  const heading = `## ${messageTitle(message)}`;
  const body = messageBodyMarkdown(message);
  return body ? `${heading}\n\n${body}` : heading;
};

const messageTitle = (message: ChatMessage): string => {
  const role = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return message.role === "tool" && message.function
    ? `${role}: ${message.function}`
    : role;
};

const messageBodyMarkdown = (message: ChatMessage): string => {
  const parts: string[] = [];
  const content = contentMarkdown(message);
  if (content) parts.push(content);
  if (message.role === "assistant") {
    for (const call of message.tool_calls ?? []) {
      const args = fenced(JSON.stringify(call.arguments, null, 2));
      parts.push(`**Tool call: ${call.function}**\n\n${args}`);
    }
  }
  if (message.role === "tool" && message.error) {
    parts.push(`**Error**\n\n${fenced(message.error.message)}`);
  }
  return parts.join("\n\n");
};

const contentMarkdown = (message: ChatMessage): string => {
  const content = message.content;
  if (typeof content === "string") {
    // Tool results render verbatim; prose keeps its Markdown.
    return message.role === "tool" ? fenced(content) : content;
  }
  return content
    .map(contentItemMarkdown)
    .filter((part): part is string => part !== null)
    .join("\n\n");
};

const contentItemMarkdown = (item: Content): string | null => {
  switch (item.type) {
    case "text":
      return textMarkdown(item);
    case "reasoning":
      return reasoningMarkdown(item);
    case "tool_use":
      return toolUseMarkdown(item);
    case "image":
    case "audio":
    case "video":
    case "data":
    case "document":
      return `<${item.type} />`;
    default:
      return null;
  }
};

const textMarkdown = (item: ContentText): string | null => item.text || null;

const reasoningMarkdown = (item: ContentReasoning): string | null => {
  // A redacted reasoning summary is reviewer-facing by design; the raw
  // chain is not.
  const text = item.redacted ? item.summary : item.reasoning || item.summary;
  return text || null;
};

const toolUseMarkdown = (item: ContentToolUse): string => {
  const invocation = `${item.name}(${item.arguments}) -> ${item.result}`;
  const withError = item.error ? `${invocation}\n${item.error}` : invocation;
  return `**Tool use: ${item.name}**\n\n${fenced(withError)}`;
};

// The fence must be longer than any backtick run inside the value.
const fenced = (value: string): string => {
  const fence = "`".repeat(Math.max(2, longestBacktickRun(value)) + 1);
  return `${fence}\n${value}\n${fence}`;
};

const longestBacktickRun = (value: string): number => {
  let longest = 0;
  let run = 0;
  for (const char of value) {
    run = char === "`" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
};
