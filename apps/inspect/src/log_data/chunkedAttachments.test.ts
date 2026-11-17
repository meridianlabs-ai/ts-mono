import { describe, expect, it } from "vitest";

import {
  testModelEvent,
  testScore,
  testScoreEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { ChatMessage, ContentImage } from "@tsmono/inspect-common/types";

import {
  ChunkByteStore,
  SequenceReader,
  type ChunkedEvent,
  type ChunkedSample,
} from "./chunked";
import { resolvedEventsReader } from "./chunkedAttachments";
import { sequenceReaderOver, testChunkedSample } from "./testFixtures";

// Wiring test for boundary normalization (#555): fails if the per-entry
// normalize step is removed from the windowed events transform.
describe("resolvedEventsReader", () => {
  const encoder = new TextEncoder();

  // The chunk bytes are whatever an older writer put on disk, so the reader
  // is typed as the contract (`ChunkedEvent`) while the items are not.
  const chunkedWithEvents = (chunkItems: unknown[]): ChunkedSample => {
    const events = new SequenceReader<ChunkedEvent>(
      new ChunkByteStore({
        readFile: () =>
          Promise.resolve(encoder.encode(JSON.stringify(chunkItems))),
      }),
      (start) => `events/${start}.json`,
      [0],
      chunkItems.length
    );
    return {
      ...testChunkedSample(sequenceReaderOver<ChatMessage>([])),
      events,
    };
  };

  it("normalizes legacy events while preserving chunk item count", async () => {
    const legacyModelEvent = { event: "model", timestamp: "t", model: "m" };
    const garbageEntry = "not-an-event";
    const chunked = chunkedWithEvents([legacyModelEvent, garbageEntry]);

    const items = await resolvedEventsReader(chunked).getRange(0, 2);

    // Count-preserving: SequenceReader's index math derives from fixed
    // chunk starts, so nothing may be dropped.
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      event: "model",
      working_start: 0,
      config: {},
      output: { model: "", choices: [], completion: "" },
    });
    // Un-event-shaped entries pass through unchanged rather than shifting
    // later ordinals.
    expect(items[1]).toBe(garbageEntry);
  });

  it("passes clean chunks through unchanged", async () => {
    const clean = {
      event: "state",
      timestamp: "t",
      working_start: 1,
      changes: [],
    };
    const chunked = chunkedWithEvents([clean]);

    const items = await resolvedEventsReader(chunked).getRange(0, 1);
    expect(items).toEqual([clean]);
  });
});

// inspect_ai's reader leaves tool result text, score explanations and event
// metadata as written, so a literal ref there is neither fetched nor
// substituted.
describe("resolvedEventsReader attachment refs", () => {
  const encoder = new TextEncoder();

  it("fetches and resolves only the refs inspect_ai resolves", async () => {
    const contents = ["system prompt", "image data"];
    const reads: string[] = [];
    const attachments = new SequenceReader<string>(
      new ChunkByteStore({
        readFile: (name) => {
          reads.push(name);
          const index = Number(name.replace(/\D/g, ""));
          return Promise.resolve(
            encoder.encode(JSON.stringify([contents[index]]))
          );
        },
      }),
      (start) => `attachments/${start}.json`,
      [0, 1],
      contents.length
    );
    const image = {
      type: "image",
      image: "attachment://1",
      detail: "auto",
    } satisfies ContentImage;
    const tool = testToolEvent({
      result: [{ type: "text", text: "attachment://0" }, image],
    });
    const score = testScoreEvent({
      score: testScore({ explanation: "attachment://0" }),
    });
    const model = testModelEvent({ metadata: { note: "tc://0" } });
    const chunked: ChunkedSample = {
      ...testChunkedSample(sequenceReaderOver<ChatMessage>([])),
      events: sequenceReaderOver<ChunkedEvent>([tool, score, model]),
      attachments,
    };

    const items = await resolvedEventsReader(chunked).getRange(0, 3);

    expect(items).toEqual([
      {
        ...tool,
        result: [
          { type: "text", text: "attachment://0" },
          { ...image, image: "image data" },
        ],
      },
      score,
      model,
    ]);
    expect(reads).toEqual(["attachments/1.json"]);
  });
});
