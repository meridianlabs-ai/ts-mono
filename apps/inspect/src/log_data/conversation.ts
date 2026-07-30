/**
 * The version-agnostic read seam over a sample's final conversation — the
 * message-space layer beneath the Messages tab's row-space seam
 * (`SampleMessagesData`). Positions are indices into the final conversation
 * (0 ≤ i < messageCount), never storage indices, and messages come back
 * fully resolved, so consumers never learn the .eval storage format: an
 * inline `sample.messages` array or a chunked sample's `message_refs` over
 * the messages sequence.
 */
import { ChatMessage } from "@tsmono/inspect-common/types";

export interface SampleConversation {
  /** Exact length of the final conversation. Cheap for every format:
   *  inline arrays know their length, chunked shells carry ref widths. */
  readonly messageCount: number;
  /** Messages `[start, end)` of the conversation, fully resolved.
   *  Out-of-range bounds clamp to `[0, messageCount)`. */
  getMessages(start: number, end: number): Promise<ChatMessage[]>;
}

/**
 * A conversation over an inline message array (monolith samples, tests) —
 * the reference implementation of the clamping contract.
 */
export const inMemoryConversation = (
  messages: ChatMessage[]
): SampleConversation => ({
  messageCount: messages.length,
  getMessages: (start, end) =>
    Promise.resolve(messages.slice(Math.max(0, start), Math.max(0, end))),
});
