import type { ContentRenderingPolicy } from "@tsmono/react/components";

import { contentTexts } from "./contentText";
import type { ResolvedMessage } from "./messages";

/**
 * Extracts searchable text from a ResolvedMessage for find-in-page
 * functionality, as the chat view shows it under `policy`.
 */
export const messageSearchText = (
  resolved: ResolvedMessage,
  policy: ContentRenderingPolicy
): string[] => {
  const texts: string[] = [];

  // Extract text from main message content
  texts.push(...contentTexts(resolved.message.content, { shown: policy }));

  // Extract tool call info from assistant messages
  if (
    resolved.message.role === "assistant" &&
    "tool_calls" in resolved.message &&
    resolved.message.tool_calls
  ) {
    for (const toolCall of resolved.message.tool_calls) {
      if (toolCall.function) {
        texts.push(toolCall.function);
      }
      texts.push(JSON.stringify(toolCall.arguments));
    }
  }

  // Extract text from tool response messages
  for (const toolMsg of resolved.toolMessages) {
    // Tool function name (displayed as "tool: function_name")
    if (toolMsg.function) {
      texts.push(toolMsg.function);
    }
    texts.push(...contentTexts(toolMsg.content, { shown: policy }));
    if (toolMsg.error?.message) {
      texts.push(toolMsg.error.message);
    }
  }

  return texts;
};
