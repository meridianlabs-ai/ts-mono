import { describe, expect, test } from "vitest";

import { EvalSample } from "@tsmono/inspect-common/types";
import { data, loading } from "@tsmono/util";

import { SampleHandle } from "../app/types";
import { SampleSummary } from "../client/api/types";

import { RunningSampleData } from "./runningSampleQuery";
import { deriveSampleData, SampleDataInputs } from "./sampleData";

const handle: SampleHandle = { logFile: "run.eval", id: "s1", epoch: 1 };

const summary = (overrides: Partial<SampleSummary> = {}): SampleSummary => ({
  id: "s1",
  epoch: 1,
  input: "input",
  target: "target",
  scores: null,
  ...overrides,
});

const sample = (overrides: Partial<EvalSample> = {}): EvalSample =>
  ({
    id: "s1",
    epoch: 1,
    events: [],
    messages: [],
    ...overrides,
  }) as EvalSample;

const events = (n: number): RunningSampleData["events"] =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i}` }) as never);

const inputs = (overrides: Partial<SampleDataInputs>): SampleDataInputs => ({
  handle,
  summary: summary(),
  query: loading,
  running: loading,
  finalizedSample: undefined,
  ...overrides,
});

describe("deriveSampleData", () => {
  test("idles without a handle or summary", () => {
    for (const input of [
      inputs({ handle: undefined }),
      inputs({ summary: undefined }),
    ]) {
      const result = deriveSampleData(input);
      expect(result.status).toBe("ok");
      expect(result.sample).toBeUndefined();
      expect(result.running).toHaveLength(0);
    }
  });

  test("running path: loads until the stream ticks, then streams", () => {
    const base = { summary: summary({ completed: false }) };

    expect(deriveSampleData(inputs(base)).status).toBe("loading");

    const streaming = deriveSampleData(
      inputs({
        ...base,
        running: data({ events: events(2), finalized: false }),
      })
    );
    expect(streaming.status).toBe("streaming");
    expect(streaming.running).toHaveLength(2);
  });

  test("running path: stream error surfaces", () => {
    const error = new Error("stream failed");
    const result = deriveSampleData(
      inputs({
        summary: summary({ completed: false }),
        running: { loading: false, error },
      })
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe(error);
  });

  test("running path: finalize hands off to the primed EvalSample without a loading flash", () => {
    const finalized = sample({ messages: [{} as never] });
    const result = deriveSampleData(
      inputs({
        summary: summary({ completed: false }),
        running: data({ events: events(1), finalized: true }),
        finalizedSample: finalized,
      })
    );
    expect(result.status).toBe("ok");
    expect(result.sample).toBe(finalized);
    // Events empty but messages present: the preprocessor stripped events.
    expect(result.eventsCleared).toBe(true);
  });

  test("running path: finalized stream without a primed EvalSample keeps streaming", () => {
    const result = deriveSampleData(
      inputs({
        summary: summary({ completed: false }),
        running: data({ events: events(1), finalized: true }),
      })
    );
    expect(result.status).toBe("streaming");
  });

  test("completed path: settled EvalSample wins", () => {
    const evalSample = sample({ events: [{} as never] });
    const result = deriveSampleData(inputs({ query: data(evalSample) }));
    expect(result.status).toBe("ok");
    expect(result.sample).toBe(evalSample);
    expect(result.eventsCleared).toBe(false);
  });

  test("completed path: cached stream events bridge the settling fetch", () => {
    const result = deriveSampleData(
      inputs({
        query: loading,
        running: data({ events: events(3), finalized: false }),
      })
    );
    expect(result.status).toBe("streaming");
    expect(result.running).toHaveLength(3);
  });

  test("completed path: loads without bridge events, surfaces fetch errors", () => {
    expect(deriveSampleData(inputs({ query: loading })).status).toBe("loading");

    const error = new Error("fetch failed");
    const errored = deriveSampleData(
      inputs({ query: { loading: false, error } })
    );
    expect(errored.status).toBe("error");
    expect(errored.error).toBe(error);
  });
});
