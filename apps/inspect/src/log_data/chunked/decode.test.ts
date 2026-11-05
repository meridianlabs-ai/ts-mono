import { describe, expect, it } from "vitest";

import { testSpanBeginEvent } from "@tsmono/inspect-common/testing";

import { ChunkByteStore, SequenceReader } from "./chunkStore";
import { decodeRange } from "./decode";
import { SkeletonIndex } from "./skeletonIndex";
import type { ChunkedEvent, SampleSkeleton } from "./types";

// Intentionally bypass the opener: a decode walk must reject non-progress
// even if a caller mutates a previously validated skeleton.
describe("decode progress", () => {
  it.each([true, false])(
    "rejects an inverted extent when collapsed=%s",
    async (collapsed) => {
      const event = testSpanBeginEvent({ id: "s" });
      const events = new SequenceReader<ChunkedEvent>(
        new ChunkByteStore({
          readFile: () =>
            Promise.resolve(new TextEncoder().encode(JSON.stringify([event]))),
        }),
        () => "events/0.json",
        [0],
        1
      );
      const skeleton: SampleSkeleton = {
        version: 1,
        counts: { events: 1, models: 0 },
        spans: [
          {
            id: "s",
            name: "s",
            begin: 0,
            extent: [0, -1],
            t: [event.timestamp, event.timestamp],
            working: [0, 0],
            events: 1,
            models: 0,
            gap_models: [0],
            children: collapsed ? { tool: 1 } : {},
          },
        ],
        notables: [],
        overflow: {},
      };
      await expect(
        decodeRange(
          {
            events,
            stats: [],
            skel: new SkeletonIndex(skeleton),
            isCollapsed: () => collapsed,
            visible: () => true,
          },
          0,
          1,
          false
        )
      ).rejects.toThrow("transcript decode did not advance");
    }
  );
});
