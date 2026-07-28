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

  const result: ChatMessage[] = [];

  // `slice(-1)` leaves the walk below only the trailing message, which it then
  // breaks on — so a trailing assistant message becomes the entire result.
  // Reads like `slice(0, -1)` was meant, but this is what ModelEventView
  // renders today and changing it would change the panel.
  let offset: number | undefined = undefined;
  const lastMessage = event.input.at(-1);
  if (lastMessage?.role === "assistant") {
    result.push(lastMessage);
    offset = -1;
  }

  for (const msg of event.input.slice(offset).reverse()) {
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
