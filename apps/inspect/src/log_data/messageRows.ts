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
 * message array today, a windowed read over a chunked sample's message_refs
 * later.
 *
 * Cursors are the app's standard `{ offset }` cursors (shared with the
 * listing layer), indexing the folded row space. Reads are forward-only:
 * `Pagination.direction` is ignored (matching `pageRows`); read the tail
 * by anchoring a forward read at `rowCount() - limit`.
 */
export interface SampleMessagesData {
  /** Exact folded-row count for the whole conversation. */
  rowCount(): Promise<number>;
  /** One page of resolved rows. */
  getRows(pagination: Pagination): Promise<MessageRowsPage>;
  /** The whole conversation as text (copy/download) — the only sanctioned
   *  full materialization. */
  exportText(): Promise<string>;
}

export interface MessageRowsPage {
  rows: MessageRow[];
  /** Absolute position of `rows[0]` in the folded row space. */
  offset: number;
  /** Count of ALL rows, not just this page. */
  totalRowCount: number;
  /** Cursor for the page after this one (null at the end). */
  nextCursor: Cursor | null;
  /** Forward-read anchor of the preceding page (null at the start). The
   *  window it opens may overlap this page's first rows when fewer than
   *  `limit` rows precede it. */
  prevCursor: Cursor | null;
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
    rowCount: () => Promise.resolve(allRows().length),
    getRows: (pagination) => {
      const all = allRows();
      const { lo, hi } = paginationRange(pagination, all.length);
      // cursors are minted only when the page made progress (hi > lo), so a
      // degenerate limit can never produce a self-referential cursor and a
      // drain-until-null loop always terminates
      return Promise.resolve({
        rows: all.slice(lo, hi),
        offset: lo,
        totalRowCount: all.length,
        nextCursor: hi < all.length && hi > lo ? { offset: hi } : null,
        prevCursor:
          lo > 0 && hi > lo
            ? { offset: Math.max(0, lo - pagination.limit) }
            : null,
      });
    },
    exportText: () => Promise.resolve(messagesToStr(messages)),
  };
};
