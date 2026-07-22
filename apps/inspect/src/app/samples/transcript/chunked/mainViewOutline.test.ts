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

import type { Event } from "@tsmono/inspect-common/types";
import type { EventNode } from "@tsmono/inspect-components/transcript";

import { openZipFileFromBuffer } from "../../../../client/remote/remoteZipFile";
import {
  syntheticEventsFromSkeleton,
  type SampleSkeleton,
} from "../../../../log_data";
import { kDefaultExcludeEvents } from "../../../../state/sampleSlice";
import { resolveAttachments } from "../../../../utils/attachments";

import { chunkedOutline, legacyOutlineNodes } from "./mainViewOutline";

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
    const parsed = JSON.parse(
      decoder.decode(await original.readFile(entry))
    ) as {
      id: string | number;
      epoch: number;
      events: Event[];
      attachments?: Record<string, string>;
    };
    const skeletonEntry = `samples/${parsed.id}_epoch_${parsed.epoch}/skeleton.json`;
    const skeleton = JSON.parse(
      decoder.decode(await chunked.readFile(skeletonEntry))
    ) as SampleSkeleton;
    samples.push({
      key: `${parsed.id}/${parsed.epoch}`,
      events: resolveAttachments(parsed.events, parsed.attachments ?? {}),
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
