import { describe, expect, it, vi } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";

import { LogDetails } from "../client/api/types";

import { FetchEngine, LogsContentSink } from "./fetchEngine";
import { testClientAPI, testLogDetails } from "./testFixtures";

const makeDetails = (name: string): LogDetails =>
  testLogDetails({
    eval: testEvalSpec({ eval_id: name, run_id: `run-${name}` }),
  });

const createSink = () => {
  const detailWrites: string[] = [];
  const sink: LogsContentSink = {
    seedRows: () => {},
    setListing: () => {},
    mergePreviews: () => {},
    writeListing: () => Promise.resolve([]),
    writePreviews: () => Promise.resolve(),
    writeDetails: (details) => {
      detailWrites.push(...Object.keys(details));
      return Promise.resolve();
    },
    mergeFetchStates: () => {},
    writeFetchStates: () => Promise.resolve(),
    resetDepth: () => Promise.resolve(),
    clearFile: () => Promise.resolve(),
    clearAll: () => Promise.resolve(),
  };
  return { sink, detailWrites };
};

describe("FetchEngine restart", () => {
  it("does not retry failed work from a stopped session through the next session", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const getDetailsA = vi.fn(async (file: string) => {
      await gate;
      throw new Error(`failed: ${file}`);
    });
    const getDetailsB = vi.fn((file: string) =>
      Promise.resolve(makeDetails(file))
    );
    const apiA = testClientAPI({ get_log_details: getDetailsA });
    const apiB = testClientAPI({ get_log_details: getDetailsB });

    const engine = new FetchEngine({
      concurrency: 1,
      flushDelayMs: 0,
      statsDelayMs: 0,
    });
    const sinkA = createSink();
    await engine.start({
      api: apiA,
      database: null,
      sink: sinkA.sink,
      logDir: "A",
    });

    const pending = engine.ensure("old.eval", {
      depth: "detailed",
      priority: "user",
    });
    await vi.waitFor(() => expect(getDetailsA).toHaveBeenCalledTimes(1));
    const stopped = expect(pending).rejects.toThrow("Fetch engine stopped");

    const sinkB = createSink();
    await engine.start({
      api: apiB,
      database: null,
      sink: sinkB.sink,
      logDir: "B",
    });
    await stopped;

    release?.();
    await vi.waitFor(() => expect(engine.getStatus().syncing).toBe(false));

    expect(getDetailsB).not.toHaveBeenCalled();
    expect(sinkB.detailWrites).toEqual([]);
  });
});
