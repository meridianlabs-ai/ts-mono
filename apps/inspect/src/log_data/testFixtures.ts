/**
 * Cast-free fixtures for log_data tests: fully-typed minimal values of the
 * generated log types, and a real ChunkedSample over in-memory chunks (no
 * `as unknown as` — fixtures break loudly when the types move).
 */
import { ChatMessage, EvalSample, Event } from "@tsmono/inspect-common/types";

import {
  ChunkByteStore,
  SequenceReader,
  SkeletonIndex,
  type ChunkedEvent,
  type ChunkedSample,
  type SampleSkeleton,
} from "./chunked";

const encoder = new TextEncoder();

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
