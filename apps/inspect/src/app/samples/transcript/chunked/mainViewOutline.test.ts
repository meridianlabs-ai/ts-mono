/**
 * Twin test for the skeleton-fed outline: `legacyOutlineNodes` (the real
 * legacy pipeline, composed from production exports) run over the ORIGINAL
 * monolith events must produce the same rows as the same pipeline run over
 * `syntheticEventsFromSkeleton` of the persisted skeleton — per sample,
 * across the fixture corpus.
 *
 * This pins the synthesis (`syntheticEvents.ts` fidelity contract), not a
 * port: both sides run the identical pipeline code.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeEvents } from "@tsmono/inspect-common/normalize";
import {
  testModelEvent,
  testScore,
  testScoreEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
  testSubtaskEvent,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";
import {
  buildOutlineNodeList,
  kDefaultExcludeEvents,
  labelForOutlineNode,
  type EventNode,
} from "@tsmono/inspect-components/transcript";
import { parsePackageName } from "@tsmono/util";

import { openZipFileFromBuffer } from "../../../../client/remote/remoteZipFile";
import {
  sampleSkeleton,
  syntheticEventsFromSkeleton,
  type SampleSkeleton,
  type SkeletonEvent,
} from "../../../../log_data";
import { resolveAttachments } from "../../../../utils/attachments";

import {
  chunkedOutline,
  legacyOutlineNodes,
  outlineViewTree,
} from "./mainViewOutline";

const fixturesDir = join(process.cwd(), "src/log_data/chunked/fixtures/logs");

interface FixtureSample {
  key: string;
  events: Event[];
  skeleton: SampleSkeleton;
}

const openZip = async (path: string) => {
  const bytes = new Uint8Array(readFileSync(path));
  return openZipFileFromBuffer(bytes);
};

const loadSamples = async (name: string): Promise<FixtureSample[]> => {
  const original = await openZip(join(fixturesDir, "original", name));
  const chunked = await openZip(join(fixturesDir, "chunked", name));
  const decoder = new TextDecoder();

  const samples: FixtureSample[] = [];
  for (const entry of original.centralDirectory.keys()) {
    const match = /^samples\/(.+)_epoch_(\d+)\.json$/.exec(entry);
    if (!match) continue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the .eval fixture on disk is the shape this suite is written against
    const parsed = JSON.parse(
      decoder.decode(await original.readFile(entry))
    ) as {
      id: string | number;
      epoch: number;
      events: Event[];
      attachments?: Record<string, string>;
    };
    const skeletonEntry = `samples/${parsed.id}_epoch_${parsed.epoch}/skeleton.json`;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- see above
    const skeleton = JSON.parse(
      decoder.decode(await chunked.readFile(skeletonEntry))
    ) as SampleSkeleton;
    samples.push({
      key: `${parsed.id}/${parsed.epoch}`,
      // The real pipeline normalizes events at the parse boundary (#555)
      // before attachment resolution; mirror it so old fixtures load.
      events: resolveAttachments(
        normalizeEvents(parsed.events),
        parsed.attachments ?? {}
      ),
      skeleton,
    });
  }
  return samples;
};

const logNames = readdirSync(join(fixturesDir, "original")).filter((name) =>
  name.endsWith(".eval")
);

const rowShape = (node: EventNode) => ({
  depth: node.depth,
  event: node.event.event,
  type: "type" in node.event ? (node.event.type ?? null) : null,
  name: "name" in node.event ? node.event.name : null,
});

describe("chunked outline twin (real pipeline: real events vs synthetic)", () => {
  it.each(logNames.map((name) => [name]))("%s", async (name) => {
    const samples = await loadSamples(name);
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      const real = legacyOutlineNodes(sample.events, kDefaultExcludeEvents);
      const synth = legacyOutlineNodes(
        syntheticEventsFromSkeleton(sample.skeleton).events,
        kDefaultExcludeEvents
      );
      expect(synth.header, sample.key).toBe(real.header);
      expect(synth.nodes.map(rowShape), sample.key).toEqual(
        real.nodes.map(rowShape)
      );
    }
    // Parity is pinned at the default event-type filter (the shipped
    // outline input). With NO filter the corpus diverges in exactly one
    // known way: legacy logs' root-level `sample_init` event is not
    // recorded in the skeleton (root-level plain events have no children
    // record), so the fixup-injected "sample_init" step row is absent.
  });

  // Hand-built streams for skeleton shapes absent from the eval corpus.
  // Full `Event` values double as SkeletonEvent (producer input) and Event
  // (pipeline input) — the union satisfies SkeletonEvent structurally.
  const ts = (i: number) =>
    `2026-01-01T00:00:${String(i).padStart(2, "0")}+00:00`;
  const modelAt = (i: number): Event =>
    testModelEvent({
      span_id: "S1",
      model: "mockllm/model",
      timestamp: ts(i),
      working_start: i,
    });
  const spanWrapped = (
    inner: Event[]
  ): { events: Event[]; skeletonEvents: SkeletonEvent[] } => {
    const all: Event[] = [
      testSpanBeginEvent({
        id: "S1",
        name: "agent1",
        type: "agent",
        timestamp: ts(0),
        working_start: 0,
      }),
      ...inner,
      testSpanEndEvent({
        id: "S1",
        span_id: "S1",
        timestamp: ts(inner.length + 1),
        working_start: inner.length + 1,
      }),
    ];
    return { events: all, skeletonEvents: all };
  };

  it("subtask strays carry a labelable payload (no outline crash)", () => {
    const { skeletonEvents } = spanWrapped([
      modelAt(1),
      testSubtaskEvent({
        span_id: "S1",
        name: "calc",
        input: {},
        result: 1,
        events: [],
        timestamp: ts(2),
        working_start: 2,
      }),
    ]);
    const synth = syntheticEventsFromSkeleton(sampleSkeleton(skeletonEvents));
    // fully expanded (no collapse): every row the outline can ever render
    const tree = outlineViewTree(
      synth.events,
      new Map(),
      kDefaultExcludeEvents
    );
    const nodes = buildOutlineNodeList(tree.eventNodes, {});
    const subtask = nodes.find((node) => node.event.event === "subtask");
    expect(subtask).toBeDefined();
    // the exact expression OutlineRow renders — crashed when strays had no name
    for (const node of nodes) {
      expect(() => parsePackageName(labelForOutlineNode(node))).not.toThrow();
    }
  });

  it("capped notables add no stray rows (twin at notable_cap)", () => {
    const { events, skeletonEvents } = spanWrapped(
      [1, 2, 3, 4].flatMap((k) => [
        modelAt(k * 2 - 1),
        testScoreEvent({
          span_id: "S1",
          score: testScore({
            value: 1,
            answer: null,
            explanation: null,
            metadata: null,
          }),
          intermediate: false,
          timestamp: ts(k * 2),
          working_start: k * 2,
        }),
      ])
    );
    const skeleton = sampleSkeleton(skeletonEvents, { notable_cap: 2 });
    expect(skeleton.overflow.score).toBe(2);
    const real = legacyOutlineNodes(events, kDefaultExcludeEvents);
    const synth = legacyOutlineNodes(
      syntheticEventsFromSkeleton(skeleton).events,
      kDefaultExcludeEvents
    );
    expect(synth.nodes.map(rowShape)).toEqual(real.nodes.map(rowShape));
  });

  it("ais-decoder matches the legacy browser outline", async () => {
    const samples = await loadSamples("ais-decoder.eval");
    const sample = samples[0];
    expect(sample).toBeDefined();
    if (!sample) return;
    const outline = chunkedOutline(sample.skeleton, kDefaultExcludeEvents);
    expect(outline.header).toBe("main");
    expect(outline.rows.map((row) => row.label)).toEqual([
      "10 turns",
      "scoring",
    ]);
  });
});
