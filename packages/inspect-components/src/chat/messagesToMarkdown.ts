import type {
  ChatMessage,
  Content,
  ContentReasoning,
  ContentText,
  ContentToolUse,
} from "@tsmono/inspect-common/types";

import { fenced, quoted } from "../content/markdownBlocks";

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

// Titled like the chat view and quoted, so the reader can tell where the
// reasoning ends and the reply begins. A redacted chain is never exported,
// only its reviewer-facing summary.
const reasoningMarkdown = (item: ContentReasoning): string | null => {
  const summary = item.redacted || !item.reasoning;
  const text = summary ? item.summary : item.reasoning;
  if (!text) return null;
  const title = summary ? "Reasoning (Summary)" : "Reasoning";
  return `**${title}**\n\n${quoted(text)}`;
};

const toolUseMarkdown = (item: ContentToolUse): string => {
  const invocation = `${item.name}(${item.arguments}) -> ${item.result}`;
  const withError = item.error ? `${invocation}\n${item.error}` : invocation;
  return `**Tool use: ${item.name}**\n\n${fenced(withError)}`;
};
