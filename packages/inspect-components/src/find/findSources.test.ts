import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testToolCall,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { ChatMessage, ModelEvent } from "@tsmono/inspect-common/types";
import type {
  FindMatch,
  FindOptions,
  FindSource,
  FindStreamItem,
  FindTotal,
} from "@tsmono/react/find";

import { buildMessageRows, messageRowOptions } from "../chat/rowsModel";

import { createMessageRowsFindSource } from "./messageRowsFindSource";
import { createTranscriptFindSource } from "./transcriptFindSource";

// =============================================================================
// Fixtures
// =============================================================================

const ev = (uuid: string, output: string): ModelEvent =>
  testModelEvent({
    uuid,
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ content: output }),
        }),
      ],
    }),
  });

const rowMap = (...ids: string[]): Map<string, string> =>
  new Map(ids.map((id) => [id, "main"]));

// =============================================================================
// Helpers
// =============================================================================

async function drain(
  source: FindSource,
  text: string,
  opts: Partial<FindOptions> = {},
  signal?: AbortSignal
): Promise<FindStreamItem[]> {
  const items: FindStreamItem[] = [];
  const controller = new AbortController();
  const stream = source.find(
    { text },
    { direction: "forward", ...opts },
    signal ?? controller.signal
  );
  for await (const item of stream) items.push(item);
  return items;
}

function matchesOf(items: FindStreamItem[]): FindMatch[] {
  return items.flatMap((i) => (i.kind === "matches" ? i.matches : []));
}

function endOf(
  items: FindStreamItem[]
): { complete: boolean; total: FindTotal } | undefined {
  const last = items[items.length - 1];
  return last?.kind === "end"
    ? { complete: last.complete, total: last.total }
    : undefined;
}

// =============================================================================
// Transcript source
// =============================================================================

describe("createTranscriptFindSource", () => {
  it("materializes matches in chronological event order with per-anchor occurrences", async () => {
    const events = [
      ev("e1", "alpha alpha"),
      ev("e2", "nothing here"),
      ev("e3", "alpha"),
    ];
    const source = createTranscriptFindSource(events, rowMap("e1", "e2", "e3"));

    const items = await drain(source, "alpha");
    expect(matchesOf(items)).toEqual([
      { anchor: { kind: "event", id: "e1" }, occurrence: 0, ordinal: 0 },
      { anchor: { kind: "event", id: "e1" }, occurrence: 1, ordinal: 0 },
      { anchor: { kind: "event", id: "e3" }, occurrence: 0, ordinal: 2 },
    ]);
    expect(endOf(items)).toEqual({
      complete: true,
      total: { value: 3, relation: "eq" },
    });
  });

  it("excludes anchors the row map cannot address (counted ⇒ reachable)", async () => {
    const events = [ev("e1", "alpha"), ev("e2", "alpha")];
    const source = createTranscriptFindSource(events, rowMap("e1"));

    const items = await drain(source, "alpha");
    expect(matchesOf(items).map((m) => m.anchor.id)).toEqual(["e1"]);
    expect(endOf(items)?.total.value).toBe(1);
  });

  it("counts quoted terms once via variant matching", async () => {
    const events = [ev("e1", 'He said "hi" loudly')];
    const source = createTranscriptFindSource(events, rowMap("e1"));

    const items = await drain(source, 'said "hi"');
    expect(matchesOf(items)).toHaveLength(1);
  });

  it("resumes strictly after a forward cursor and before a backward one", async () => {
    const events = [ev("e1", "x"), ev("e2", "x"), ev("e3", "x")];
    const source = createTranscriptFindSource(events, rowMap("e1", "e2", "e3"));

    const forward = await drain(source, "x", {
      cursor: { anchor: { kind: "event", id: "e2" }, occurrence: 0 },
    });
    expect(matchesOf(forward).map((m) => m.anchor.id)).toEqual(["e3"]);

    const backward = await drain(source, "x", {
      direction: "backward",
      cursor: { anchor: { kind: "event", id: "e2" }, occurrence: 0 },
    });
    expect(matchesOf(backward).map((m) => m.anchor.id)).toEqual(["e1"]);

    const backwardAll = await drain(source, "x", { direction: "backward" });
    expect(matchesOf(backwardAll).map((m) => m.anchor.id)).toEqual([
      "e3",
      "e2",
      "e1",
    ]);
  });

  it("caps the streamed page at the limit while reporting the exact total", async () => {
    const events = Array.from({ length: 5 }, (_, i) => ev(`e${i}`, "x"));
    const source = createTranscriptFindSource(
      events,
      rowMap(...events.map((e) => e.uuid!))
    );

    const items = await drain(source, "x", { limit: 2 });
    expect(matchesOf(items)).toHaveLength(2);
    expect(endOf(items)).toEqual({
      complete: true,
      total: { value: 5, relation: "eq" },
    });
  });

  it("stops streaming without an end item when aborted", async () => {
    const events = [ev("e1", "x"), ev("e2", "x")];
    const source = createTranscriptFindSource(events, rowMap("e1", "e2"));
    const controller = new AbortController();
    controller.abort();

    const items = await drain(source, "x", {}, controller.signal);
    expect(items).toEqual([]);
  });
});

// =============================================================================
// Messages source
// =============================================================================

describe("createMessageRowsFindSource", () => {
  const rows = (messages: ChatMessage[]) =>
    buildMessageRows(messages, messageRowOptions());

  it("anchors matches to the row's message id with row ordinals", async () => {
    const source = createMessageRowsFindSource(
      rows([
        testUserMessage({ id: "u1", content: "wondering about things" }),
        testAssistantMessage({ id: "a1", content: "keep wondering" }),
      ])
    );

    const items = await drain(source, "wondering");
    expect(matchesOf(items)).toEqual([
      { anchor: { kind: "message", id: "u1" }, occurrence: 0, ordinal: 0 },
      { anchor: { kind: "message", id: "a1" }, occurrence: 0, ordinal: 1 },
    ]);
  });

  it("excludes rows without a message id from the projection", async () => {
    const source = createMessageRowsFindSource(
      rows([
        testUserMessage({ id: null, content: "wondering" }),
        testUserMessage({ id: "u2", content: "wondering" }),
      ])
    );

    const items = await drain(source, "wondering");
    expect(matchesOf(items).map((m) => m.anchor.id)).toEqual(["u2"]);
    expect(endOf(items)?.total.value).toBe(1);
  });

  it("runs occurrences across the row's folded tool messages", async () => {
    const assistant = testAssistantMessage({
      id: "a1",
      content: "run the needle tool",
      tool_calls: [
        testToolCall({ id: "t1", function: "needle_fn", arguments: {} }),
      ],
    });
    const tool = testToolMessage({
      id: "tm1",
      tool_call_id: "t1",
      function: "needle_fn",
      content: "needle output",
    });
    const source = createMessageRowsFindSource(rows([assistant, tool]));

    const items = await drain(source, "needle");
    const matches = matchesOf(items);
    // All occurrences share the head message's anchor, numbered in
    // projection order across content + tool call + tool response.
    expect(matches.every((m) => m.anchor.id === "a1")).toBe(true);
    expect(matches.map((m) => m.occurrence)).toEqual(matches.map((_, i) => i));
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
