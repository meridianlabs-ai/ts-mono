import { describe, expect, it } from "vitest";

import { SampleSummary } from "../client/api/types";
import { resolveSample } from "../log_data";

import { synthesizeErroredSampleFromSummary } from "./sampleUtils";

const baseSummary = (
  overrides: Partial<SampleSummary> = {}
): SampleSummary => ({
  id: "rocket-medium-vision",
  epoch: 1,
  input: "task input",
  target: "expected target",
  scores: null,
  error: "RuntimeError: server.py exited before becoming ready",
  completed: true,
  ...overrides,
});

describe("synthesizeErroredSampleFromSummary", () => {
  it("populates EvalSample.error from the summary's error string", () => {
    const sample = synthesizeErroredSampleFromSummary(baseSummary());

    expect(sample.error).toBeTruthy();
    expect(sample.error?.message).toBe(
      "RuntimeError: server.py exited before becoming ready"
    );
    expect(sample.error?.traceback).toBe(
      "RuntimeError: server.py exited before becoming ready"
    );
    expect(sample.error?.traceback_ansi).toBe(
      "RuntimeError: server.py exited before becoming ready"
    );
  });

  it("does not propagate the summary's string limit (EvalSample.limit is an object | null)", () => {
    const sample = synthesizeErroredSampleFromSummary(
      baseSummary({ limit: "context" })
    );

    expect(sample.limit).toBeNull();
  });

  it("returns empty events / messages / attachments / output", () => {
    const sample = synthesizeErroredSampleFromSummary(baseSummary());

    expect(sample.events).toEqual([]);
    expect(sample.messages).toEqual([]);
    expect(sample.attachments).toEqual({});
    expect(sample.output).toBeDefined();
    expect(sample.output.choices).toEqual([]);
  });

  it("survives resolveSample without throwing", () => {
    const sample = synthesizeErroredSampleFromSummary(baseSummary());
    expect(() => resolveSample(sample)).not.toThrow();
  });

  it("throws if the summary has no error", () => {
    expect(() =>
      synthesizeErroredSampleFromSummary(baseSummary({ error: undefined }))
    ).toThrow();
  });
});
