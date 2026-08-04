import { describe, expect, it } from "vitest";

import { ChatMessage } from "@tsmono/inspect-common/types";
import { messagesToStr } from "@tsmono/inspect-components/chat";

import { type Cursor } from "../client/database/listing";

import { inMemoryConversation, type SampleConversation } from "./conversation";
import {
  inMemoryMessageRows,
  type MessageRowsPage,
  type SampleMessagesData,
} from "./messageRows";
import { windowedMessageRows } from "./messageRowsWindowed";

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

const trailingToolRun: ChatMessage[] = [
  { role: "user", content: "go" },
  {
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "c-9", function: "bash", arguments: {}, type: "function" },
    ],
  },
  { role: "tool", content: "part 1", tool_call_id: "c-9" },
  { role: "tool", content: "part 2", tool_call_id: "c-9" },
];

const plainConversation = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, i): ChatMessage => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }));

const drain = async (
  source: SampleMessagesData,
  pageSize: number
): Promise<MessageRowsPage[]> => {
  const pages: MessageRowsPage[] = [];
  let cursor: Cursor | null = null;
  do {
    const page: MessageRowsPage = await source.getRows({
      cursor,
      direction: "forward",
      limit: pageSize,
    });
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
};

const collectText = async (source: SampleMessagesData): Promise<string> => {
  const parts: string[] = [];
  for await (const part of source.exportText()) {
    parts.push(part);
  }
  return parts.join("");
};

/** A conversation instrumented with how far reads have actually gone. */
const instrumented = (messages: ChatMessage[]) => {
  const inner = inMemoryConversation(messages);
  const stats: { rawHigh: number; resolved: [number, number][] } = {
    rawHigh: 0,
    resolved: [],
  };
  const conversation: SampleConversation = {
    messageCount: inner.messageCount,
    getMessages: (start, end) => {
      stats.resolved.push([start, end]);
      return inner.getMessages(start, end);
    },
    getMessagesRaw: (start, end) => {
      stats.rawHigh = Math.max(stats.rawHigh, end);
      return inner.getMessagesRaw(start, end);
    },
  };
  return { conversation, stats };
};

const kPageSizes = [1, 2, 3, 5, 100];

describe("windowedMessageRows equivalence", () => {
  const conversations: [string, ChatMessage[]][] = [
    ["kitchen sink", kitchenSink],
    ["leading tools", leadingTools],
    ["no system", noSystem],
    ["trailing tool run", trailingToolRun],
    ["plain 700 (batch-crossing)", plainConversation(700)],
    ["empty", []],
  ];

  it.each(conversations)(
    "%s: paged drains reproduce the in-memory fold",
    async (_name, messages) => {
      const oracle = await inMemoryMessageRows(messages).getRows({
        cursor: null,
        direction: "forward",
        limit: Number.MAX_SAFE_INTEGER,
      });
      for (const pageSize of kPageSizes) {
        const source = windowedMessageRows(inMemoryConversation(messages));
        const pages = await drain(source, pageSize);
        expect(pages.flatMap((page) => page.rows)).toEqual(oracle.rows);

        const last = pages[pages.length - 1]!;
        expect(last.exhausted).toBe(true);
        expect(last.knownRowCount).toBe(oracle.knownRowCount);
        expect(last.nextCursor).toBeNull();
        // offsets tile the row space without gaps or overlap
        let expected = 0;
        for (const page of pages) {
          expect(page.offset).toBe(expected);
          expected += page.rows.length;
        }
      }
    }
  );

  it.each(conversations)(
    "%s: exportText streams the exact conversation text",
    async (_name, messages) => {
      const source = windowedMessageRows(inMemoryConversation(messages));
      expect(await collectText(source)).toBe(messagesToStr(messages));
    }
  );

  it("serves any page standalone with whole-conversation numbering", async () => {
    const oracle = await inMemoryMessageRows(kitchenSink).getRows({
      cursor: null,
      direction: "forward",
      limit: Number.MAX_SAFE_INTEGER,
    });
    // a fresh source per read: no earlier page needed for correctness
    for (let offset = 0; offset < oracle.rows.length; offset++) {
      const source = windowedMessageRows(inMemoryConversation(kitchenSink));
      const page = await source.getRows({
        cursor: { offset },
        direction: "forward",
        limit: 2,
      });
      expect(page.rows).toEqual(oracle.rows.slice(offset, offset + 2));
      expect(page.offset).toBe(offset);
    }
  });
});

describe("windowedMessageRows laziness", () => {
  it("scans only as far as the requested rows require", async () => {
    const { conversation, stats } = instrumented(plainConversation(2000));
    const source = windowedMessageRows(conversation);

    const page = await source.getRows({
      cursor: null,
      direction: "forward",
      limit: 10,
    });
    expect(page.rows.length).toBe(10);
    expect(page.exhausted).toBe(false);
    // one scan batch of raw reads, nothing near the conversation's end
    expect(stats.rawHigh).toBeLessThanOrEqual(512);
    // resolved reads cover only the served window
    for (const [start, end] of stats.resolved) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(stats.rawHigh);
    }
    expect(page.knownRowCount).toBeGreaterThanOrEqual(10);
    expect(page.knownRowCount).toBeLessThan(2000);
  });

  it("reports a monotonically growing knownRowCount across reads", async () => {
    const { conversation } = instrumented(plainConversation(2000));
    const source = windowedMessageRows(conversation);
    const first = await source.getRows({
      cursor: null,
      direction: "forward",
      limit: 5,
    });
    const further = await source.getRows({
      cursor: { offset: 1000 },
      direction: "forward",
      limit: 5,
    });
    expect(further.knownRowCount).toBeGreaterThanOrEqual(first.knownRowCount);
    expect(further.rows[0]?.startNumber).toBe(1001);
  });
});

describe("windowedMessageRows cursor contract", () => {
  it("never mints a cursor that reproduces the same page", async () => {
    const source = windowedMessageRows(inMemoryConversation(noSystem));
    const stuck = await source.getRows({
      cursor: { offset: 1 },
      direction: "forward",
      limit: 0,
    });
    expect(stuck.rows).toEqual([]);
    expect(stuck.nextCursor).toBeNull();
  });

  it("clamps an out-of-range cursor once exhausted", async () => {
    const source = windowedMessageRows(inMemoryConversation(noSystem));
    const page = await source.getRows({
      cursor: { offset: 50 },
      direction: "forward",
      limit: 5,
    });
    expect(page.rows).toEqual([]);
    expect(page.exhausted).toBe(true);
    expect(page.offset).toBe(page.knownRowCount);
    expect(page.nextCursor).toBeNull();
  });

  it("ignores Pagination.direction — backward requests read the same forward window", async () => {
    const source = windowedMessageRows(inMemoryConversation(kitchenSink));
    const fwd = await source.getRows({
      cursor: { offset: 1 },
      direction: "forward",
      limit: 2,
    });
    const bwd = await source.getRows({
      cursor: { offset: 1 },
      direction: "backward",
      limit: 2,
    });
    expect(bwd.rows).toEqual(fwd.rows);
  });
});

describe("windowedMessageRows late-system discovery", () => {
  it("re-reads reflect a system message found deep in the conversation", async () => {
    // system content past the first scan batch: early pages fold without
    // a merged row 0; once discovered, fresh reads include it
    const messages: ChatMessage[] = [
      ...plainConversation(600),
      { role: "system", content: "late system" },
      { role: "user", content: "tail" },
    ];
    const source = windowedMessageRows(inMemoryConversation(messages));

    const early = await source.getRows({
      cursor: null,
      direction: "forward",
      limit: 3,
    });
    expect(early.rows[0]?.resolved.message.role).not.toBe("system");

    // drive the scan to the end, then re-read the first page
    await drain(source, 200);
    const reread = await source.getRows({
      cursor: null,
      direction: "forward",
      limit: 3,
    });
    expect(reread.rows[0]?.resolved.message.role).toBe("system");

    // and the whole re-read drain matches the in-memory fold
    const oracle = await inMemoryMessageRows(messages).getRows({
      cursor: null,
      direction: "forward",
      limit: Number.MAX_SAFE_INTEGER,
    });
    const pages = await drain(source, 100);
    expect(pages.flatMap((page) => page.rows)).toEqual(oracle.rows);
  });
});
