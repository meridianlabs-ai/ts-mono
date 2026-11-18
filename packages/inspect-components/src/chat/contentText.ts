import type { Content, ContentReasoning } from "@tsmono/inspect-common/types";

import { serverToolTexts } from "./server-tools/serverToolView";

/**
 * The reasoning text the chat view shows: the summary when the chain is
 * redacted (it is encrypted) or missing, otherwise the chain itself.
 * `summary` says which one it is; undefined when there is nothing to show.
 */
export const reasoningText = (
  item: ContentReasoning
): { text: string; summary: boolean } | undefined => {
  const summary = item.redacted || !item.reasoning;
  const text = summary ? item.summary : item.reasoning;
  return text ? { text, summary } : undefined;
};

/**
 * The text strings a message's content holds, one per part, for find and the
 * transcript's text exports. Media never contribute their base64 payloads:
 * exports get an `<image />`-style placeholder, and server tool calls give
 * their raw arguments and result. `shown` limits the strings to what the chat
 * view renders (no placeholders; server tool calls as `ServerToolCall` parses
 * them), for the Messages tab's Find.
 */
export const contentTexts = (
  content: string | readonly Content[],
  { shown = false }: { shown?: boolean } = {}
): string[] => {
  if (typeof content === "string") return [content];
  const texts: string[] = [];
  for (const item of content) {
    switch (item.type) {
      case "text":
        texts.push(item.text);
        break;
      case "reasoning": {
        const reasoning = reasoningText(item);
        if (reasoning) texts.push(reasoning.text);
        break;
      }
      case "tool_use":
        if (shown) {
          texts.push(...serverToolTexts(item));
          break;
        }
        for (const text of [
          item.name,
          item.arguments,
          item.result,
          item.error,
        ]) {
          if (text) texts.push(text);
        }
        break;
      case "image":
      case "audio":
      case "video":
      case "data":
      case "document":
        if (!shown) texts.push(`<${item.type} />`);
        break;
    }
  }
  return texts;
};
