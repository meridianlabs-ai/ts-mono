/**
 * Cast-free fixtures for log_data tests: fully-typed minimal values of the
 * generated log types, and a real ChunkedSample over in-memory chunks (no
 * `as unknown as` — fixtures break loudly when the types move).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, ReactNode } from "react";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testEvalSample,
  testModelEvent,
  testModelOutput,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import { ChatMessage, EvalSample, Event } from "@tsmono/inspect-common/types";

import { SampleHandle } from "../app/types";
import { DatabaseManager, DatabaseService } from "../client/database";

import {
  ChunkByteStore,
  SequenceReader,
  SkeletonIndex,
  type ChunkedEvent,
  type ChunkedSample,
  type SampleSkeleton,
} from "./chunked";
import { type EvalSampleData } from "./sampleData";

const encoder = new TextEncoder();

export const testHandle: SampleHandle = {
  logFile: "log.eval",
  id: "s1",
  epoch: 1,
};

/** Sample data for a settled (fetched, non-streaming) monolith sample. */
export const settledData = (messages: ChatMessage[]): EvalSampleData => ({
  sample: testEvalSampleWithMessages(messages),
  status: "ok",
  error: undefined,
  running: [],
  eventsCleared: false,
  backfilling: false,
});

/** A renderHook wrapper providing a QueryClient. */
export const makeWrapper = (client: QueryClient = new QueryClient()) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

export const testMessages = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, i): ChatMessage => ({
    id: `m-${i}`,
    role: "user",
    content: `message ${i}`,
  }));

export const testEvalSampleWithMessages = (
  messages: ChatMessage[]
): EvalSample =>
  testEvalSample({
    id: "s1",
    input: "input",
    target: "",
    messages,
    output: testModelOutput({ model: "test" }),
  });

export {
  testClientAPI,
  testLogDetails,
  testLogHeader,
  testSampleSummary,
} from "../client/api/testClientApi";

/**
 * A real, never-opened DatabaseService with the given methods overridden —
 * un-overridden calls fail loudly ("No database initialized") and `opened()`
 * reports false unless a fake supplies its own.
 */
export const testDatabaseService = (
  overrides: Partial<DatabaseService> = {}
): DatabaseService =>
  Object.assign(new DatabaseService(new DatabaseManager()), overrides);

/** A model event whose input/output messages carry the given ids. */
export const testModelEventWithIds = (
  inputId: string,
  outputId: string
): Event =>
  testModelEvent({
    model: "test",
    timestamp: "2026-01-01T00:00:00+00:00",
    input: [testUserMessage({ id: inputId, content: "hello", source: null })],
    output: testModelOutput({
      model: "test",
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({
            id: outputId,
            content: "response",
            source: "generate",
          }),
        }),
      ],
    }),
  });

/** A real single-chunk reader over an in-memory item array. */
export const sequenceReaderOver = <T>(items: T[]): SequenceReader<T> =>
  new SequenceReader(
    new ChunkByteStore({
      readFile: () => Promise.resolve(encoder.encode(JSON.stringify(items))),
    }),
    (start) => `chunk/${start}.json`,
    [0],
    items.length
  );

/** A reader whose every read rejects — hydration/read failure paths. */
export const failingSequenceReader = <T>(error: Error): SequenceReader<T> =>
  new SequenceReader(
    new ChunkByteStore({ readFile: () => Promise.reject(error) }),
    (start) => `chunk/${start}.json`,
    [0],
    undefined
  );

const emptySkeleton: SampleSkeleton = {
  version: 1,
  counts: { events: 0, models: 0 },
  spans: [],
  notables: [],
  overflow: {},
};

/**
 * A ChunkedSample whose conversation reads from `messages`; everything
 * else is real-but-empty. `messageRefs` defaults to one range covering
 * the reader's known count.
 */
export const testChunkedSample = (
  messages: SequenceReader<ChatMessage>,
  messageRefs?: [number, number][]
): ChunkedSample => ({
  shell: {
    id: "s1",
    epoch: 1,
    message_refs: messageRefs ?? [[0, messages.knownCount]],
  },
  skeleton: emptySkeleton,
  skel: new SkeletonIndex(emptySkeleton),
  stats: [],
  events: sequenceReaderOver<ChunkedEvent>([]),
  messages,
  calls: sequenceReaderOver<unknown>([]),
  attachments: sequenceReaderOver<string>([]),
  uuidToOrdinal: () => Promise.resolve(undefined),
});
