/**
 * Gate + full-hydration tests over the fixture corpus. The fixtures carry
 * no producer timelines, so gate-true cases are built by overriding the
 * opened sample's shell/stats; hydration itself is exercised directly
 * (it is independent of the gate).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Timeline } from "@tsmono/inspect-common/types";

import type { LogZipAccess } from "../client/remote/remoteLogFile";
import { openZipFileFromBuffer } from "../client/remote/remoteZipFile";

import { openChunkedSample, type ChunkedSample } from "./chunked";
import {
  hydrateFullSample,
  shouldFullyHydrate,
  TIMELINE_HYDRATION_BYTES,
} from "./chunkedHydrate";

const logsDir = join(
  process.cwd(),
  "src/log_data/chunked/fixtures/logs/chunked"
);
const logNames = readdirSync(logsDir).filter((name) => name.endsWith(".eval"));

interface OpenedSample {
  sample: ChunkedSample;
  zipAccess: LogZipAccess;
}

const openSamples = async (name: string): Promise<OpenedSample[]> => {
  const bytes = new Uint8Array(readFileSync(join(logsDir, name)));
  const zip = await openZipFileFromBuffer(bytes);
  const entryNames = new Set(zip.centralDirectory.keys());
  const zipAccess: LogZipAccess = {
    entryNames,
    readFile: (n) => zip.readFile(n),
    uncompressedSize: (n) => zip.centralDirectory.get(n)?.uncompressedSize,
  };
  const refs = [...entryNames].flatMap((entry) => {
    const m = /^samples\/(.+)_epoch_(\d+)\/sample\.json$/.exec(entry);
    return m ? [{ id: m[1] ?? "", epoch: Number(m[2]) }] : [];
  });
  return Promise.all(
    refs.map(async ({ id, epoch }) => ({
      sample: await openChunkedSample(zip, entryNames, id, epoch),
      zipAccess,
    }))
  );
};

const fakeTimeline: Timeline = {
  name: "target",
  description: "",
  root: {
    id: "root",
    name: "root",
    type: "span",
    branches: [],
    content: [],
    tool_invoked: false,
    utility: false,
  },
};

const withTimelines = (sample: ChunkedSample): ChunkedSample => ({
  ...sample,
  shell: { ...sample.shell, timelines: [fakeTimeline] },
});

describe("shouldFullyHydrate", () => {
  it("declines samples without timelines or branch/anchor events", async () => {
    for (const name of logNames) {
      for (const { sample, zipAccess } of await openSamples(name)) {
        expect(shouldFullyHydrate(sample, zipAccess)).toBe(false);
      }
    }
  });

  it("hydrates timeline'd samples under the byte gate", async () => {
    const [first] = await openSamples(logNames[0] ?? "");
    if (!first) throw new Error("no fixture samples");
    expect(
      shouldFullyHydrate(withTimelines(first.sample), first.zipAccess)
    ).toBe(true);
  });

  it("hydrates branched samples detected from stats", async () => {
    const [first] = await openSamples(logNames[0] ?? "");
    if (!first) throw new Error("no fixture samples");
    const branched: ChunkedSample = {
      ...first.sample,
      stats: first.sample.stats.map((chunk, i) =>
        i === 0
          ? { ...chunk, type_counts: { ...chunk.type_counts, anchor: 1 } }
          : chunk
      ),
    };
    expect(shouldFullyHydrate(branched, first.zipAccess)).toBe(true);
  });

  it("declines timeline'd samples over the byte gate", async () => {
    const [first] = await openSamples(logNames[0] ?? "");
    if (!first) throw new Error("no fixture samples");
    const huge: LogZipAccess = {
      ...first.zipAccess,
      uncompressedSize: () => TIMELINE_HYDRATION_BYTES,
    };
    expect(shouldFullyHydrate(withTimelines(first.sample), huge)).toBe(false);
  });
});

describe("hydrateFullSample", () => {
  it("strips the legacy `sequences` shell field", async () => {
    const [first] = await openSamples(logNames[0] ?? "");
    if (!first) throw new Error("no fixture samples");
    const hydrated = await hydrateFullSample({
      ...first.sample,
      // shells converted before the central-directory layout carry this
      shell: { ...first.sample.shell, sequences: { events: [0] } },
    });
    expect("sequences" in hydrated).toBe(false);
  });

  it.each(logNames.map((name) => [name]))("%s", async (name) => {
    for (const { sample } of await openSamples(name)) {
      const hydrated = await hydrateFullSample(sample);

      // complete event stream, in the resolved monolith shape
      expect(hydrated.events.length).toBe(sample.events.knownCount);
      expect(hydrated.events.length).toBe(sample.skeleton.counts.events);

      // final conversation rebuilt from message_refs
      const refWidths = sample.shell.message_refs.reduce(
        (n, [start, end]) => n + (end - start),
        0
      );
      expect(hydrated.messages.length).toBe(refWidths);

      // pool refs expanded, attachment refs resolved — nothing lazy remains
      const serialized = JSON.stringify(hydrated);
      expect(serialized).not.toContain('"attachment://');
      for (const event of hydrated.events) {
        if (event.event === "model") {
          expect(event.input_refs ?? null).toBeNull();
        }
      }

      // metadata rejoins the sample when the sidecar entry exists
      if (sample.readMetadata) {
        expect(hydrated.metadata).toStrictEqual(await sample.readMetadata());
      }
    }
  });
});
