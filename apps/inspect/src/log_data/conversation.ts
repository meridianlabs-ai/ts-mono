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

import { type ChunkedSample } from "./chunked";
import { log } from "./chunked/log";
import { withAttachmentsResolved } from "./chunkedAttachments";

export interface SampleConversation {
  /** Exact length of the final conversation. Cheap for every format:
   *  inline arrays know their length, chunked shells carry ref widths. */
  readonly messageCount: number;
  /** Messages `[start, end)` of the conversation, fully resolved.
   *  Out-of-range bounds clamp to `[0, messageCount)`. */
  getMessages(start: number, end: number): Promise<ChatMessage[]>;
  /**
   * Messages `[start, end)` with attachment refs left unresolved — for
   * scans that only inspect structure (roles, tool calls, content
   * presence) and must not pay attachment downloads. Same clamping.
   */
  getMessagesRaw(start: number, end: number): Promise<ChatMessage[]>;
}

/**
 * A conversation over an inline message array (monolith samples, tests) —
 * the reference implementation of the clamping contract. Inline messages
 * are already fully resolved, so raw reads are the same reads.
 */
export const inMemoryConversation = (
  messages: ChatMessage[]
): SampleConversation => {
  const getMessages = (start: number, end: number) =>
    Promise.resolve(messages.slice(Math.max(0, start), Math.max(0, end)));
  return {
    messageCount: messages.length,
    getMessages,
    getMessagesRaw: getMessages,
  };
};

/**
 * Map conversation positions `[start, end)` to half-open ranges of the
 * messages sequence via `message_refs` — the whole chunked-format
 * coordinate mapping, kept pure. A linear walk: refs top out around 8k on
 * the largest measured sample (compaction multiplies them), negligible per
 * read.
 */
export const conversationRanges = (
  refs: readonly [number, number][],
  start: number,
  end: number
): [number, number][] => {
  const ranges: [number, number][] = [];
  let pos = 0;
  for (const [lo, hi] of refs) {
    if (pos >= end) {
      break;
    }
    const takeLo = Math.max(start - pos, 0);
    const takeHi = Math.min(end - pos, hi - lo);
    if (takeLo < takeHi) {
      ranges.push([lo + takeLo, lo + takeHi]);
    }
    pos += hi - lo;
  }
  return ranges;
};

/**
 * A conversation over a chunked sample's `message_refs`: sequence ranges
 * fetched per read, attachment refs substituted before anything downstream
 * sees them. Attachments resolve per range as each range's messages arrive,
 * so attachment downloads overlap the remaining message downloads instead
 * of serializing behind the read's assembly.
 */
export const chunkedConversation = (
  chunked: ChunkedSample
): SampleConversation => {
  const refs = chunked.shell.message_refs;
  const messageCount = refs.reduce((n, [start, end]) => n + (end - start), 0);
  const readRanges = async (
    start: number,
    end: number,
    resolve: boolean
  ): Promise<ChatMessage[]> => {
    const lo = Math.max(0, start);
    const hi = Math.min(Math.max(lo, end), messageCount);
    const ranges = conversationRanges(refs, lo, hi);
    const label = `conversation [${lo}, ${hi})${resolve ? "" : " (raw)"}`;
    const parts = await Promise.all(
      ranges.map(async ([rangeLo, rangeHi], i) => {
        const messages = await chunked.messages.getRange(rangeLo, rangeHi);
        return resolve
          ? withAttachmentsResolved(messages, chunked, `${label} range ${i}`)
          : messages;
      })
    );
    const messages = parts.flat();
    log.info(
      `read ${label}: ${messages.length} messages via ` +
        `${ranges.length} range${ranges.length === 1 ? "" : "s"}`
    );
    return messages;
  };
  return {
    messageCount,
    getMessages: (start, end) => readRanges(start, end, true),
    getMessagesRaw: (start, end) => readRanges(start, end, false),
  };
};
