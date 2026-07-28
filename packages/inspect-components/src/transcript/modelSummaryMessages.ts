import type { ChatMessage, ModelEvent } from "@tsmono/inspect-common/types";

export interface SummaryInputOptions {
  /**
   * Include tool-role messages. Set when the client emits no tool events, so
   * tool results have nowhere else to appear.
   */
  includeToolMessages?: boolean;
}

/**
 * The `event.input` messages the model event's SUMMARY panel draws: the
 * trailing run of user/system messages, plus a trailing assistant message
 * (which may be a compaction summary).
 *
 * Single-sourced so the find index can't drift from what's on screen.
 */
export const summaryInputMessages = (
  event: ModelEvent,
  opts?: SummaryInputOptions
): ChatMessage[] => {
  // Agent tool results have been filtered from input (shown on AgentCard
  // instead), so contribute nothing from input; the trailing assistant message
  // the panel shows comes from `output.choices`, not from this function.
  if ((event as Record<string, unknown>).agentResultsFiltered) {
    return [];
  }

  const result: ChatMessage[] = [];

  // A trailing assistant message (possibly a compaction summary) is taken as
  // the whole result: `slice(-1)` leaves only that message for the walk below,
  // which then breaks on it. Reads like it was meant to be `slice(0, -1)`, but
  // this mirrors what ModelEventView renders today and changing it would change
  // the panel.
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
