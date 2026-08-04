import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@tsmono/inspect-common/types";

import {
  buildMessageRows,
  buildMessageRowsWindow,
  buildSystemMessageRow,
  countRowBlocks,
  MessageRowOptions,
  messageRowOptions,
  MessageRowScanner,
  type MessageRow,
} from "./rowsModel";

describe("messageRowOptions", () => {
  it("fills the fold defaults", () => {
    expect(messageRowOptions()).toEqual({
      toolCallStyle: "complete",
      collapseToolMessages: true,
    });
  });

  it("honors explicit tool options", () => {
    expect(
      messageRowOptions({ callStyle: "compact", collapseToolMessages: false })
    ).toEqual({
      toolCallStyle: "compact",
      collapseToolMessages: false,
    });
  });
});

// a conversation exercising every windowing hazard: minted ids (no id
// fields anywhere), a merged-away mid-conversation system message, a tool
// message trailing that system message (dropped by the fold), an
// assistant row whose chat message is skipped from numbering (tool calls,
// no visible content), and multi-tool runs
const kitchenSink: ChatMessage[] = [
  { role: "system", content: "be helpful" },
  { role: "user", content: "hi" },
  {
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "c-1", function: "bash", arguments: {}, type: "function" },
      { id: "c-2", function: "python", arguments: {}, type: "function" },
    ],
  },
  { role: "tool", content: "ok", tool_call_id: "c-1" },
  { role: "tool", content: "ok", tool_call_id: "c-2" },
  { role: "system", content: "mid-conversation system" },
  { role: "tool", content: "orphaned by the system fold", tool_call_id: "c-2" },
  { role: "assistant", content: "done" },
  { role: "user", content: "more" },
  {
    role: "assistant",
    content: "using a tool",
    tool_calls: [
      { id: "c-3", function: "bash", arguments: {}, type: "function" },
    ],
  },
  { role: "tool", content: "ok", tool_call_id: "c-3" },
  { role: "assistant", content: "bye" },
];

const leadingTools: ChatMessage[] = [
  { role: "tool", content: "orphan", tool_call_id: "c-0" },
  { role: "user", content: "hi" },
  { role: "assistant", content: "hello" },
];

const noSystem: ChatMessage[] = [
  { role: "user", content: "hi" },
  { role: "assistant", content: "hello" },
];

/**
 * Serve the whole conversation the way a windowed source would: scan for
 * row facts, then fold row-aligned windows of `pageSize` rows, stitching
 * numbering from the scanned prefix sums and synthesizing the merged
 * system row from scanned positions.
 */
const reconstruct = (
  messages: ChatMessage[],
  pageSize: number,
  options: MessageRowOptions
): MessageRow[] => {
  const scanner = new MessageRowScanner(options);
  messages.forEach((message, i) => {
    scanner.next(message, i);
  });
  expect(scanner.completedRowCount(true)).toBe(scanner.rows.length);

  const out: MessageRow[] = [];
  let number = 1;
  if (scanner.hasSystemRow) {
    const systemRow = buildSystemMessageRow(
      scanner.systemStarts.map((i) => messages[i]!)
    );
    expect(systemRow).toBeDefined();
    out.push(systemRow!);
    number += countRowBlocks(systemRow!.resolved, options.toolCallStyle);
  }
  const startNumbers = scanner.rows.map((fact) => number + fact.blocksBefore);
  for (let lo = 0; lo < scanner.rows.length; lo += pageSize) {
    const hi = Math.min(lo + pageSize, scanner.rows.length);
    const msgLo = scanner.rows[lo]!.start;
    const msgHi =
      hi < scanner.rows.length ? scanner.rows[hi]!.start : messages.length;
    out.push(
      ...buildMessageRowsWindow(
        messages.slice(msgLo, msgHi),
        msgLo,
        startNumbers[lo]!,
        options
      )
    );
  }
  return out;
};

const kPageSizes = [1, 2, 3, 5, 100];

describe("windowed fold equivalence", () => {
  const conversations: [string, ChatMessage[]][] = [
    ["kitchen sink", kitchenSink],
    ["leading tools", leadingTools],
    ["no system", noSystem],
    ["empty", []],
  ];

  it.each(conversations)("%s: collapse on", (_name, messages) => {
    const options = messageRowOptions();
    const full = buildMessageRows(messages, options);
    for (const pageSize of kPageSizes) {
      expect(reconstruct(messages, pageSize, options)).toEqual(full);
    }
  });

  it.each(conversations)("%s: collapse off", (_name, messages) => {
    const options = messageRowOptions({
      callStyle: "complete",
      collapseToolMessages: false,
    });
    const full = buildMessageRows(messages, options);
    for (const pageSize of kPageSizes) {
      expect(reconstruct(messages, pageSize, options)).toEqual(full);
    }
  });

  it("kitchen sink: compact call style numbers one block per row", () => {
    const options = messageRowOptions({
      callStyle: "compact",
      collapseToolMessages: true,
    });
    const full = buildMessageRows(kitchenSink, options);
    expect(full.map((row) => row.startNumber)).toEqual(
      full.map((_, i) => i + 1)
    );
    for (const pageSize of kPageSizes) {
      expect(reconstruct(kitchenSink, pageSize, options)).toEqual(full);
    }
  });
});

describe("MessageRowScanner", () => {
  const feed = (messages: ChatMessage[], upTo?: number): MessageRowScanner => {
    const scanner = new MessageRowScanner(messageRowOptions());
    messages.slice(0, upTo).forEach((message, i) => {
      scanner.next(message, i);
    });
    return scanner;
  };

  it("keeps the last row open until a later non-tool message seals it", () => {
    // through the two tool results of the first assistant row (positions
    // 0..4): the assistant row's tool run could still grow
    const open = feed(kitchenSink, 5);
    expect(open.rows.length).toBe(2);
    expect(open.completedRowCount(false)).toBe(1);
    expect(open.completedRowCount(true)).toBe(2);

    // the mid-conversation system message is a boundary: it seals the
    // assistant row without starting a conversation row
    const sealed = feed(kitchenSink, 6);
    expect(sealed.rows.length).toBe(2);
    expect(sealed.completedRowCount(false)).toBe(2);
  });

  it("completes every row on discovery when folding is off", () => {
    const scanner = new MessageRowScanner(
      messageRowOptions({ callStyle: "complete", collapseToolMessages: false })
    );
    kitchenSink.slice(0, 3).forEach((message, i) => {
      scanner.next(message, i);
    });
    expect(scanner.rows.length).toBe(3);
    expect(scanner.completedRowCount(false)).toBe(3);
  });

  it("tracks system content without emitting rows for it", () => {
    const scanner = feed(kitchenSink);
    expect(scanner.systemStarts).toEqual([0, 5]);
    expect(scanner.hasSystemRow).toBe(true);
    expect(scanner.rows.map((fact) => fact.start)).toEqual([1, 2, 7, 8, 9, 11]);
  });

  it("has no system row until system content is actually seen", () => {
    const scanner = feed(kitchenSink, 5);
    expect(scanner.systemStarts).toEqual([0]);
    expect(scanner.hasSystemRow).toBe(true);
    expect(feed(noSystem).hasSystemRow).toBe(false);
  });

  it("accumulates block prefix sums from head messages alone", () => {
    const scanner = feed(kitchenSink);
    // row block widths are [1, 2, 1, 1, 2, 1]: an assistant with two tool
    // calls and no visible content renders 2 blocks (chat message
    // skipped); one call plus visible content renders 2 (message + call)
    expect(scanner.rows.map((fact) => fact.blocksBefore)).toEqual([
      0, 1, 3, 4, 5, 7,
    ]);
  });

  it("treats empty-array system content as no system row", () => {
    const contentlessSystem: ChatMessage = { role: "system", content: [] };
    const scanner = new MessageRowScanner(messageRowOptions());
    scanner.next(contentlessSystem, 0);
    expect(scanner.hasSystemRow).toBe(false);
    expect(buildSystemMessageRow([contentlessSystem])).toBeUndefined();
  });
});
