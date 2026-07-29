import type { ChatMessage } from "@tsmono/inspect-common/types";

import { Message, ResolvedMessage, resolveMessages } from "./messages";
import { ChatViewToolOptions } from "./types";

/** A folded chat row plus its whole-conversation numbering fact. */
export interface MessageRow {
  resolved: ResolvedMessage;
  /** Global sequential number of the row's first rendered block. */
  startNumber: number;
}

export interface MessageRowOptions {
  toolCallStyle: ChatViewToolOptions["callStyle"];
  collapseToolMessages: boolean;
}

/**
 * Fold messages into rows and attach start numbers — the whole-conversation
 * derivation the chat list renders from (tool folding, block prefix sums).
 * React-free so data-layer sources can build rows without dragging in
 * JSX/CSS modules.
 */
export const buildMessageRows = (
  messages: ChatMessage[],
  options: MessageRowOptions
): MessageRow[] => {
  const resolved = options.collapseToolMessages
    ? resolveMessages(messages)
    : messages.map((message) => ({
        message,
        toolMessages: [],
      }));
  let next = 1;
  return resolved.map((row) => {
    const startNumber = next;
    next += countRowBlocks(row, options.toolCallStyle);
    return { resolved: row, startNumber };
  });
};

export const hasVisibleContent = (message: Message): boolean => {
  const content = message.content;
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((c) => {
    if (c.type === "tool_use") {
      // Server-side tool calls render as their own rows of the turn
      // container, so they make the message worth rendering.
      return true;
    }
    if (c.type === "text") {
      const hasText = c.text.trim().length > 0;
      const hasCitations = !!c.citations && c.citations.length > 0;
      return hasText || hasCitations;
    }
    if (c.type === "reasoning") {
      const hasReasoning = c.reasoning.trim().length > 0;
      const hasSummary = (c.summary?.trim().length ?? 0) > 0;
      // Empty redacted blocks (e.g. Google's position-only function_call
      // anchors with no signature) are pure structural metadata and have
      // nothing to display. Real encrypted-reasoning blocks (OpenAI
      // encrypted_content, Anthropic redacted-thinking) carry the encrypted
      // bytes in `reasoning` itself, so `hasReasoning` is true for them and
      // they remain visible.
      return hasReasoning || hasSummary;
    }
    return true;
  });
};

/**
 * Number of sequentially-numbered blocks a row renders. Only the full
 * (un-embedded) layout numbers tool calls individually; every other style
 * keeps the legacy one-number-per-row behavior.
 */
export const countRowBlocks = (
  resolved: ResolvedMessage,
  toolCallStyle: ChatViewToolOptions["callStyle"]
): number => {
  if (toolCallStyle !== "complete") return 1;
  const message = resolved.message;
  const hasToolCalls =
    message.role === "assistant" && !!message.tool_calls?.length;
  const skipChatMessage = hasToolCalls && !hasVisibleContent(message);
  return (
    (skipChatMessage ? 0 : 1) + (hasToolCalls ? message.tool_calls!.length : 0)
  );
};
