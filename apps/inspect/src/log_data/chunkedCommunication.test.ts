/**
 * The Communication tab's read of a chunked swarm sample that the viewer
 * reads in windows (e2e/fixtures/communication/generate_chunked_log.py: the
 * communication e2e log, converted by inspect_ai with chunk_size=3 and no
 * timelines).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { communicationEntries } from "../app/samples/communication/communicationEntries";
import type { LogZipAccess } from "../client/remote/remoteLogFile";
import { openZipFileFromBuffer } from "../client/remote/remoteZipFile";
import { installNodeWorker } from "../test/nodeWorker";

import { openChunkedSample, type ChunkedSample } from "./chunked";
import {
  chunkedHasCommunication,
  readChunkedCommunicationEvents,
} from "./chunkedCommunication";
import { hydrateFullSample, shouldFullyHydrate } from "./chunkedHydrate";

const fixture = join(
  process.cwd(),
  "e2e/fixtures/communication/swarm-chunked.eval"
);

interface Opened {
  sample: ChunkedSample;
  zip: LogZipAccess;
  /** Entries read since the sample was opened. */
  reads: string[];
}

const open = async (id: string): Promise<Opened> => {
  const zip = await openZipFileFromBuffer(
    new Uint8Array(readFileSync(fixture))
  );
  const entryNames = new Set(zip.centralDirectory.keys());
  const reads: string[] = [];
  const access: LogZipAccess = {
    entryNames,
    readFile: (name) => {
      reads.push(name);
      return zip.readFile(name);
    },
    uncompressedSize: (name) =>
      zip.centralDirectory.get(name)?.uncompressedSize,
  };
  const sample = await openChunkedSample(access, entryNames, id, 1);
  reads.length = 0;
  return { sample, zip: access, reads };
};

describe("a windowed chunked swarm sample", () => {
  it("takes the windowed path", async () => {
    const { sample, zip } = await open("swarm");
    expect(shouldFullyHydrate(sample, zip)).toBe(false);
  });

  it("has communication by its chunk stats", async () => {
    const { sample, reads } = await open("swarm");
    expect(chunkedHasCommunication(sample)).toBe(true);
    expect(reads).toEqual([]);
    expect(chunkedHasCommunication((await open("plain")).sample)).toBe(false);
  });

  it("reads the same communication as the whole sample", async () => {
    const { sample } = await open("swarm");
    const whole = await hydrateFullSample(sample);
    const expected = communicationEntries(whole.events);
    expect(expected.length).toBeGreaterThan(0);

    const windowed = await open("swarm");
    const events = await readChunkedCommunicationEvents(windowed.sample);
    expect(communicationEntries(events)).toStrictEqual(expected);

    // and every event the run-scoped joins read, as the whole sample has them
    const members = new Set(
      whole.events.flatMap((e) =>
        e.event === "communication" && e.agent_span_id ? [e.agent_span_id] : []
      )
    );
    const joined = whole.events.filter(
      (e) =>
        e.event === "communication" ||
        (e.event === "swarm" && e.kind === "swarm_start") ||
        (e.event === "span_begin" && members.has(e.id))
    );
    expect(members.size).toBeGreaterThan(1);
    expect(joined.some((e) => e.event === "swarm")).toBe(true);
    expect(events).toStrictEqual(joined);
    // the long message is an attachment, resolved
    expect(JSON.stringify(events)).toContain("step 39");
    expect(JSON.stringify(events)).not.toContain("attachment://");
  });

  it("reads only the event chunks that hold what the tab joins", async () => {
    const { sample, reads } = await open("swarm");
    await readChunkedCommunicationEvents(sample);

    const eventChunks = reads.filter((name) => /\/events\/\d+/.test(name));
    const needed = sample.stats
      .filter(
        (chunk) =>
          chunk.type_counts["communication"] ||
          chunk.type_counts["swarm"] ||
          chunk.type_counts["span_begin"]
      )
      .map((chunk) => chunk.start);
    expect(eventChunks.length).toBeGreaterThan(0);
    expect(eventChunks.length).toBeLessThan(sample.stats.length);
    for (const name of eventChunks) {
      expect(needed).toContain(Number(/\/events\/(\d+)/.exec(name)?.[1]));
    }
    expect(reads.filter((name) => /\/(messages|calls)\//.test(name))).toEqual(
      []
    );
  });
});

installNodeWorker();
