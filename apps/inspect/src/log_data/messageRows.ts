import { Pagination } from "@tsmono/inspect-common/query";
import { ChatMessage } from "@tsmono/inspect-common/types";
import {
  buildMessageRows,
  messageRowOptions,
  messagesToStr,
  type MessageRow,
  type MessageRowOptions,
} from "@tsmono/inspect-components/chat";

/**
 * The data-access interface for a sample's Messages tab. Consumers speak
 * positions in the folded row space — resolved rows with whole-conversation
 * numbering attached — and never learn where the rows come from: an inline
 * message array today, a windowed read over a chunked sample's message_refs
 * later.
 *
 * Cursors are opaque `{ position }` values meaning "index in the folded
 * row result"; every input and output is data (no closures cross the
 * interface).
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
  nextCursor: MessageRowsCursor | null;
  /** Cursor for the page before this one (null at the start). */
  prevCursor: MessageRowsCursor | null;
}

/** Opaque to consumers; sources realize it as a row offset. */
export interface MessageRowsCursor {
  position: number;
  [key: string]: unknown;
}

const cursorPosition = (pagination: Pagination): number | undefined => {
  const position = pagination.cursor?.["position"];
  return typeof position === "number" ? position : undefined;
};

/**
 * Resolve a `Pagination` to the half-open row range it requests against a
 * known total. Forward reads start AT the cursor; backward reads end just
 * BEFORE it. No cursor anchors at the start (forward) or the end
 * (backward).
 */
export const paginationRange = (
  pagination: Pagination,
  total: number
): { lo: number; hi: number } => {
  const position = cursorPosition(pagination);
  if (pagination.direction === "backward") {
    const hi = Math.max(0, Math.min(position ?? total, total));
    return { lo: Math.max(0, hi - pagination.limit), hi };
  }
  const lo = Math.max(0, Math.min(position ?? 0, total));
  return { lo, hi: Math.min(lo + pagination.limit, total) };
};

// derived, not restated: the render-side defaults in messageRowOptions
// are the single authority for how conversations fold
export const kDefaultMessageRowOptions: MessageRowOptions =
  messageRowOptions();

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
      return Promise.resolve({
        rows: all.slice(lo, hi),
        offset: lo,
        totalRowCount: all.length,
        nextCursor: hi < all.length ? { position: hi } : null,
        prevCursor: lo > 0 ? { position: lo } : null,
      });
    },
    exportText: () => Promise.resolve(messagesToStr(messages)),
  };
};
