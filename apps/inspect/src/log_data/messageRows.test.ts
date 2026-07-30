import { describe, expect, it } from "vitest";

import { Pagination } from "@tsmono/inspect-common/query";
import { ChatMessage } from "@tsmono/inspect-common/types";
import {
  countRowBlocks,
  messagesToStr,
  resolveMessages,
} from "@tsmono/inspect-components/chat";

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

const forward = (position: number | undefined, limit: number): Pagination => ({
  cursor: position === undefined ? null : { position },
  direction: "forward",
  limit,
});

const backward = (position: number | undefined, limit: number): Pagination => ({
  cursor: position === undefined ? null : { position },
  direction: "backward",
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
    let cursor: { position: number } | null = null;
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

  it("pages backward from the end to the start", async () => {
    const source = inMemoryMessageRows(messages);
    const all = await source.getRows(forward(undefined, 100));

    const rows: MessageRowsPage["rows"] = [];
    let cursor: { position: number } | null = null;
    for (;;) {
      const page: MessageRowsPage = await source.getRows({
        cursor,
        direction: "backward",
        limit: 2,
      });
      rows.unshift(...page.rows);
      if (page.prevCursor === null) break;
      cursor = page.prevCursor;
    }

    expect(rows).toEqual(all.rows);
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
  it("anchors cursorless reads at the start (forward) and end (backward)", () => {
    expect(paginationRange(forward(undefined, 3), 10)).toEqual({
      lo: 0,
      hi: 3,
    });
    expect(paginationRange(backward(undefined, 3), 10)).toEqual({
      lo: 7,
      hi: 10,
    });
  });

  it("treats the cursor as start (forward) and exclusive end (backward)", () => {
    expect(paginationRange(forward(4, 3), 10)).toEqual({ lo: 4, hi: 7 });
    expect(paginationRange(backward(4, 3), 10)).toEqual({ lo: 1, hi: 4 });
  });

  it("clamps at both boundaries", () => {
    expect(paginationRange(forward(9, 5), 10)).toEqual({ lo: 9, hi: 10 });
    expect(paginationRange(backward(1, 5), 10)).toEqual({ lo: 0, hi: 1 });
    expect(paginationRange(forward(99, 5), 10)).toEqual({ lo: 10, hi: 10 });
  });

  it("clamps negative cursor positions in both directions", () => {
    expect(paginationRange(forward(-5, 3), 10)).toEqual({ lo: 0, hi: 3 });
    // unclamped, hi < 0 slices from the sequence end and mints a
    // self-referential nextCursor
    expect(paginationRange(backward(-5, 3), 10)).toEqual({ lo: 0, hi: 0 });
  });
});
