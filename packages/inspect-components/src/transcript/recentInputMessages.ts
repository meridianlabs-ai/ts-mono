import type { ChatMessage } from "@tsmono/inspect-common/types";

export interface RecentInputMessagesOptions {
  /** Agent tool results were filtered from input (shown on AgentCard instead). */
  agentResultsFiltered: boolean;
  /** Whether the client renders tool events (tool messages hide here if so). */
  hasToolEvents: boolean | undefined;
}

/**
 * The user/system messages which immediately preceded a model call — the
 * "recent messages" panel of ModelEventView. Walks backward from the end of
 * the input, collecting trailing user/system messages (and tool messages when
 * the client renders no tool events), stopping at the first assistant/tool
 * message. Everything earlier is hidden behind "show all messages".
 */
export function recentInputMessages(
  input: ChatMessage[],
  options: RecentInputMessagesOptions
): ChatMessage[] {
  const result: ChatMessage[] = [];

  if (!options.agentResultsFiltered) {
    // if there is an assistant message immediately before then include this
    // (as it could be an assistant compaction message)
    let offset: number | undefined = undefined;
    const lastMessage = input.at(-1);
    if (lastMessage?.role === "assistant") {
      result.push(lastMessage);
      offset = -1;
    }

    for (const msg of input.slice(offset).reverse()) {
      if (
        (msg.role === "user" && !msg.tool_call_id) ||
        msg.role === "system" ||
        // If the client doesn't support tool events, then tools messages are allowed to be displayed
        // in this view, since no tool events will be shown.
        (options.hasToolEvents === false && msg.role === "tool")
      ) {
        result.unshift(msg);
      } else {
        break;
      }
    }
  }

  // Multi-Agent V2 forks copy the parent's context into the child as
  // user/system messages only, so the walk above finds no assistant/tool
  // message to stop at and classifies the entire forked history as recent.
  // Only in that degenerate case (whole input consumed), fall back to the
  // real turn boundary: the last inter-agent handoff message.
  if (result.length === input.length && result.length > 0) {
    const lastHandoff = result.findLastIndex(isAgentHandoffMessage);
    if (lastHandoff > 0) {
      return result.slice(lastHandoff);
    }
  }

  return result;
}

/**
 * A user message the agent bridge synthesized from a Codex Multi-Agent V2
 * `agent_message` item (inter-agent handoff). The bridge preserves the raw
 * item on ContentText.internal for native replay; its presence marks the
 * message as the start of the receiving agent's turn.
 */
export function isAgentHandoffMessage(message: ChatMessage): boolean {
  if (message.role !== "user" || typeof message.content === "string") {
    return false;
  }
  return message.content.some(
    (content) =>
      content.type === "text" &&
      typeof content.internal === "object" &&
      content.internal !== null &&
      !Array.isArray(content.internal) &&
      "agent_message" in content.internal
  );
}
