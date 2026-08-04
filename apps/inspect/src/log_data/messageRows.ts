import { Pagination } from "@tsmono/inspect-common/query";
import { ChatMessage } from "@tsmono/inspect-common/types";
import {
  buildMessageRows,
  messageRowOptions,
  messagesToStr,
  type MessageRow,
  type MessageRowOptions,
} from "@tsmono/inspect-components/chat";

import { type Cursor } from "../client/database/listing";

/**
 * The data-access interface for a sample's Messages tab. Consumers speak
 * positions in the folded row space — resolved rows with whole-conversation
 * numbering attached — and never learn where the rows come from: an inline
 * message array, or a windowed read over a chunked sample's message_refs.
 *
 * Cursors are the app's standard `{ offset }` cursors (shared with the
 * listing layer), indexing the folded row space. Reads are forward-only:
 * `Pagination.direction` is ignored (matching `pageRows`). There is
 * deliberately no total-count call: an exact total requires scanning the
 * whole conversation, and no consumer needs one — pages report how many
 * rows are known so far and whether that is everything.
 */
export interface SampleMessagesData {
  /** One page of resolved rows. */
  getRows(pagination: Pagination): Promise<MessageRowsPage>;
  /** The whole conversation as text (copy/download), streamed in parts —
   *  concatenating every part yields exactly the conversation text. A
   *  windowed source bounds each part's residency rather than
   *  materializing the whole text at once. */
  exportText(): AsyncIterable<string>;
}

export interface MessageRowsPage {
  rows: MessageRow[];
  /** Absolute position of `rows[0]` in the folded row space. */
  offset: number;
  /** Rows known to exist so far — the exact total once `exhausted`, a
   *  monotonically growing lower bound before that (a lazy source only
   *  scans as far as reads have required). */
  knownRowCount: number;
  /** Whether `knownRowCount` is the whole conversation. */
  exhausted: boolean;
  /** Cursor for the page after this one (null at the end). */
  nextCursor: Cursor | null;
}

/**
 * Resolve a `Pagination` to the half-open row range it requests against a
 * known total: `limit` rows starting AT the cursor's offset (or the start).
 */
export const paginationRange = (
  pagination: Pagination,
  total: number
): { lo: number; hi: number } => {
  const offset = pagination.cursor?.["offset"];
  const lo = Math.max(
    0,
    Math.min(typeof offset === "number" ? offset : 0, total)
  );
  return { lo, hi: Math.min(lo + Math.max(pagination.limit, 0), total) };
};

// derived, not restated: the render-side defaults in messageRowOptions
// are the single authority for how conversations fold
export const kDefaultMessageRowOptions: MessageRowOptions = messageRowOptions();

/**
 * A source over an inline message array (monolith samples and hydrated
 * chunked samples — every source in this stage).
 */
export const inMemoryMessageRows = (
  messages: ChatMessage[],
  options: MessageRowOptions = kDefaultMessageRowOptions
): SampleMessagesData => {
  // built on first use, not construction: sources get created during render
  // memos and the fold over a large conversation isn't free
  let rows: MessageRow[] | undefined;
  const allRows = (): MessageRow[] => {
    rows ??= buildMessageRows(messages, options);
    return rows;
  };

  return {
    getRows: (pagination) => {
      const all = allRows();
      const { lo, hi } = paginationRange(pagination, all.length);
      // cursors are minted only when the page made progress (hi > lo), so a
      // degenerate limit can never produce a self-referential cursor and a
      // drain-until-null loop always terminates
      return Promise.resolve({
        rows: all.slice(lo, hi),
        offset: lo,
        knownRowCount: all.length,
        exhausted: true,
        nextCursor: hi < all.length && hi > lo ? { offset: hi } : null,
      });
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    exportText: async function* () {
      yield messagesToStr(messages);
    },
  };
};
