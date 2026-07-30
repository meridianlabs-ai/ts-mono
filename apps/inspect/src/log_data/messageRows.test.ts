import { describe, expect, it } from "vitest";

import { Pagination } from "@tsmono/inspect-common/query";
import { ChatMessage } from "@tsmono/inspect-common/types";
import {
  countRowBlocks,
  messagesToStr,
  resolveMessages,
} from "@tsmono/inspect-components/chat";

import { type Cursor } from "../client/database/listing";
import {
  inMemoryMessageRows,
  paginationRange,
  type MessageRowsPage,
} from "./messageRows";

const messages: ChatMessage[] = [
  { id: "sys-1", role: "system", content: "be helpful" },
  { id: "u-1", role: "user", content: "hi" },
  {
    id: "a-1",
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "c-1", function: "bash", arguments: {}, type: "function" },
      { id: "c-2", function: "python", arguments: {}, type: "function" },
    ],
  },
  { id: "t-1", role: "tool", content: "ok", tool_call_id: "c-1" },
  { id: "t-2", role: "tool", content: "ok", tool_call_id: "c-2" },
  { id: "a-2", role: "assistant", content: "done" },
];

const forward = (offset: number | undefined, limit: number): Pagination => ({
  cursor: offset === undefined ? null : { offset },
  direction: "forward",
  limit,
});

describe("inMemoryMessageRows", () => {
  it("folds and numbers rows exactly as the legacy component derivation", async () => {
    const source = inMemoryMessageRows(messages);
    const page = await source.getRows(forward(undefined, 100));

    // the legacy ChatViewVirtualList computation: resolveMessages then a
    // countRowBlocks prefix sum
    const resolved = resolveMessages(messages);
    const startNumbers: number[] = [];
    let next = 1;
    for (const row of resolved) {
      startNumbers.push(next);
      next += countRowBlocks(row, "complete");
    }

    expect(page.rows.map((r) => r.resolved)).toEqual(resolved);
    expect(page.rows.map((r) => r.startNumber)).toEqual(startNumbers);
    expect(page.totalRowCount).toBe(resolved.length);
    await expect(source.rowCount()).resolves.toBe(resolved.length);
  });

  it("pages forward exhaustively without gaps or overlap", async () => {
    const source = inMemoryMessageRows(messages);
    const all = await source.getRows(forward(undefined, 100));

    const pages: MessageRowsPage[] = [];
    let cursor: Cursor | null = null;
    do {
      const page: MessageRowsPage = await source.getRows({
        cursor,
        direction: "forward",
        limit: 2,
      });
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(pages.flatMap((p) => p.rows)).toEqual(all.rows);
    expect(pages.map((p) => p.offset)).toEqual(
      pages.map((_, i) => i * 2).slice(0, pages.length)
    );
    expect(pages.at(-1)?.nextCursor).toBeNull();
  });

  it("mints prevCursor as the forward anchor of the preceding page", async () => {
    const source = inMemoryMessageRows(messages);
    const total = await source.rowCount();

    const tail = await source.getRows(forward(total - 2, 2));
    expect(tail.prevCursor).toEqual({ offset: Math.max(0, total - 4) });

    const first = await source.getRows(forward(undefined, 2));
    expect(first.prevCursor).toBeNull();
  });

  it("ignores Pagination.direction — backward requests read the same forward window", async () => {
    const source = inMemoryMessageRows(messages);
    const fwd = await source.getRows(forward(1, 2));
    const bwd = await source.getRows({
      cursor: { offset: 1 },
      direction: "backward",
      limit: 2,
    });
    expect(bwd).toEqual(fwd);
  });

  it("never mints a cursor that reproduces the same page", async () => {
    const source = inMemoryMessageRows(messages);
    const stuck = await source.getRows(forward(2, 0));
    expect(stuck.rows).toEqual([]);
    expect(stuck.nextCursor).toBeNull();
    expect(stuck.prevCursor).toBeNull();
  });

  it("clamps an out-of-range cursor instead of failing", async () => {
    const source = inMemoryMessageRows(messages);
    const total = await source.rowCount();
    const past = await source.getRows(forward(total + 50, 2));
    expect(past.rows).toEqual([]);
    expect(past.offset).toBe(total);
    expect(past.nextCursor).toBeNull();
  });

  it("exports the conversation text from the original messages", async () => {
    const source = inMemoryMessageRows(messages);
    await expect(source.exportText()).resolves.toBe(messagesToStr(messages));
  });

  it("handles an empty conversation", async () => {
    const source = inMemoryMessageRows([]);
    await expect(source.rowCount()).resolves.toBe(0);
    const page = await source.getRows(forward(undefined, 10));
    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.prevCursor).toBeNull();
  });
});

describe("paginationRange", () => {
  it("anchors cursorless reads at the start", () => {
    expect(paginationRange(forward(undefined, 3), 10)).toEqual({
      lo: 0,
      hi: 3,
    });
  });

  it("treats the cursor as the start of the range", () => {
    expect(paginationRange(forward(4, 3), 10)).toEqual({ lo: 4, hi: 7 });
  });

  it("clamps at both boundaries", () => {
    expect(paginationRange(forward(9, 5), 10)).toEqual({ lo: 9, hi: 10 });
    expect(paginationRange(forward(99, 5), 10)).toEqual({ lo: 10, hi: 10 });
  });

  it("clamps negative cursor offsets and limits", () => {
    expect(paginationRange(forward(-5, 3), 10)).toEqual({ lo: 0, hi: 3 });
    expect(paginationRange(forward(4, -3), 10)).toEqual({ lo: 4, hi: 4 });
  });
});
