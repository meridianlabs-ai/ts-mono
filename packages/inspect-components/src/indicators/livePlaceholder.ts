import type { ChatMessage } from "@tsmono/inspect-common/types";

export function isLivePlaceholderMessage(message: ChatMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.tool_calls && message.tool_calls.length > 0) return false;
  return !messageHasVisibleContent(message);
}

function messageHasVisibleContent(message: ChatMessage): boolean {
  const content = message.content;
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((c) => {
    if (c.type === "tool_use") return false;
    if (c.type === "text") {
      const hasText = c.text.trim().length > 0;
      const hasCitations = !!c.citations && c.citations.length > 0;
      return hasText || hasCitations;
    }
    if (c.type === "reasoning") {
      const hasReasoning = c.reasoning.trim().length > 0;
      const hasSummary = (c.summary?.trim().length ?? 0) > 0;
      return hasReasoning || hasSummary;
    }
    return true;
  });
}
