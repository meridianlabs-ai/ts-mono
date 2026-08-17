/**
 * Cast-free fixtures for log_data tests: fully-typed minimal values of the
 * generated log types, and a real ChunkedSample over in-memory chunks (no
 * `as unknown as` — fixtures break loudly when the types move).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, ReactNode } from "react";

import { testEvalSpec } from "@tsmono/inspect-common/testing";
import { ChatMessage, EvalSample, Event } from "@tsmono/inspect-common/types";

import { SampleHandle } from "../app/types";
import {
  ClientAPI,
  LogDetails,
  LogHeader,
  SampleSummary,
} from "../client/api/types";
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
  sample: testEvalSample(messages),
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

export const testEvalSample = (messages: ChatMessage[]): EvalSample => ({
  id: "s1",
  epoch: 1,
  input: "input",
  target: "",
  messages,
  events: [],
  attachments: {},
  metadata: {},
  store: {},
  model_usage: {},
  role_usage: {},
  output: { model: "test", completion: "", choices: [] },
});

export const testSampleSummary = (
  overrides: Partial<SampleSummary> = {}
): SampleSummary => ({
  id: "s1",
  epoch: 1,
  input: "input",
  target: "",
  scores: null,
  ...overrides,
});

export const testLogDetails = (
  overrides: Partial<LogDetails> = {}
): LogDetails => ({
  version: 2,
  status: "success",
  eval: testEvalSpec(),
  sampleSummaries: [],
  ...overrides,
});

/** The stored form of a details payload (LogHeader), with sample facts zeroed. */
export const testLogHeader = (
  overrides: Partial<LogHeader> = {}
): LogHeader => ({
  eval: testEvalSpec(),
  sampleCount: 0,
  sampleErrorCount: 0,
  sampleLimits: [],
  ...overrides,
});

const notImplemented = (name: string) => () => {
  throw new Error(`${name} not implemented in test`);
};

/**
 * A complete ClientAPI whose required methods throw unless overridden.
 * Optional methods stay undefined so presence-probing code paths behave as
 * they would against a backend that lacks them.
 */
export const testClientAPI = (
  overrides: Partial<ClientAPI> = {}
): ClientAPI => ({
  get_logs: notImplemented("get_logs"),
  get_eval_set: notImplemented("get_eval_set"),
  get_flow: notImplemented("get_flow"),
  get_log_summaries: notImplemented("get_log_summaries"),
  get_log_summaries_settled: notImplemented("get_log_summaries_settled"),
  get_log_details: notImplemented("get_log_details"),
  get_log_info: notImplemented("get_log_info"),
  get_log_sample: notImplemented("get_log_sample"),
  client_events: notImplemented("client_events"),
  download_file: notImplemented("download_file"),
  open_log_file: notImplemented("open_log_file"),
  get_app_config: notImplemented("get_app_config"),
  ...overrides,
});

/**
 * A real, never-opened DatabaseService with the given methods overridden —
 * un-overridden calls fail loudly ("No database initialized") and `opened()`
 * reports false unless a fake supplies its own.
 */
export const testDatabaseService = (
  overrides: Partial<DatabaseService> = {}
): DatabaseService =>
  Object.assign(new DatabaseService(new DatabaseManager()), overrides);

export const testModelEvent = (inputId: string, outputId: string): Event => ({
  event: "model",
  model: "test",
  timestamp: "2026-01-01T00:00:00+00:00",
  working_start: 0,
  config: {},
  tools: [],
  tool_choice: "auto",
  input: [{ id: inputId, role: "user", content: "hello", source: null }],
  output: {
    model: "test",
    completion: "",
    choices: [
      {
        stop_reason: "stop",
        message: {
          id: outputId,
          role: "assistant",
          content: "response",
          source: "generate",
        },
      },
    ],
  },
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
