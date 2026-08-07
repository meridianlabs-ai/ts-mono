import type { ChatMessage, ModelEvent } from "@tsmono/inspect-common/types";

export interface SummaryInputOptions {
  /** Set when the client emits no tool events, so tool results have nowhere else to appear. */
  includeToolMessages?: boolean;
}

/**
 * The `event.input` messages the model event's SUMMARY panel draws: the
 * trailing run of user/system messages — or, when `input` ends with an
 * assistant message, only that message (see below).
 *
 * Single-sourced so the find index can't drift from what's on screen.
 */
export const summaryInputMessages = (
  event: ModelEvent,
  opts?: SummaryInputOptions
): ChatMessage[] => {
  // Input was filtered because AgentCard shows the agent's tool results
  // instead; what the panel still draws comes from `output.choices`.
  if ((event as Record<string, unknown>).agentResultsFiltered) {
    return [];
  }

  // A trailing assistant message is the entire result: the original walked
  // `slice(-1)`, which left the loop below only that message to break on.
  // Reads like `slice(0, -1)` was meant, but this is what ModelEventView
  // renders today and changing it would change the panel.
  const lastMessage = event.input.at(-1);
  if (lastMessage?.role === "assistant") {
    return [lastMessage];
  }

  const result: ChatMessage[] = [];
  for (const msg of event.input.slice().reverse()) {
    if (
      (msg.role === "user" && !msg.tool_call_id) ||
      msg.role === "system" ||
      (opts?.includeToolMessages === true && msg.role === "tool")
    ) {
      result.unshift(msg);
    } else {
      break;
    }
  }

  return result;
};
