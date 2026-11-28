import { describe, expect, it } from "vitest";

import {
  normalizeEvalSample,
  normalizeEvalStats,
  normalizeSampleSummary,
} from "./index";

const row = { id: "s1", epoch: 1, input: "hi", target: "" };

// a record that leaves out every field with a default
const sparseSample = {
  guard: { steps: { tool_call: {} }, human_reviews: {} },
};

const filledSample = {
  guard: {
    steps: { tool_call: { total: 0, judged: 0, unjudged: {} } },
    actions: null,
    human_reviews: { total: 0, answered: 0, timed_out: 0, cancelled: 0 },
    complete: true,
    incomplete_reason: null,
    remote: null,
  },
};

describe("sentinel_stats defaults", () => {
  it.each([
    {
      name: "a sample",
      read: (stats: unknown) =>
        normalizeEvalSample({ ...row, sentinel_stats: stats }).sentinel_stats,
    },
    {
      name: "a sample summary",
      read: (stats: unknown) =>
        normalizeSampleSummary({ ...row, sentinel_stats: stats })
          ?.sentinel_stats,
    },
  ])("fills what $name's sparse stats leave out", ({ read }) => {
    expect(read(sparseSample)).toEqual(filledSample);
  });

  it("fills what an eval's sparse stats leave out, so they read as the eval's", () => {
    const stats = normalizeEvalStats({
      sentinel_stats: { guard: { steps: { tool_call: { total: 2 } } } },
    })?.sentinel_stats;
    expect(stats).toEqual({
      guard: {
        steps: { tool_call: { total: 2, judged: 0, unjudged: {} } },
        actions: null,
        human_reviews: null,
        model_calls: 0,
        unrecorded_calls: 0,
        samples: 0,
        incomplete_samples: 0,
      },
    });
    expect(stats?.["guard"]).toHaveProperty("samples");
  });

  it("keeps fields the viewer doesn't know while filling the rest", () => {
    const stats = normalizeEvalSample({
      ...row,
      sentinel_stats: {
        guard: {
          future: "kept",
          steps: { tool_call: { total: 1, future: "kept" } },
        },
      },
    }).sentinel_stats;
    expect(stats).toMatchObject({
      guard: {
        future: "kept",
        complete: true,
        steps: { tool_call: { total: 1, judged: 0, future: "kept" } },
      },
    });
  });

  it.each([
    { name: "complete stats", stats: filledSample },
    { name: "null stats", stats: null },
  ])("passes a summary with $name through as it came", ({ stats }) => {
    const raw = {
      ...row,
      scores: null,
      metadata: {},
      completed: true,
      model_usage: {},
      role_usage: {},
      model_fallbacks: [],
      sentinel_stats: stats,
    };
    expect(normalizeSampleSummary(raw)).toBe(raw);
  });

  it("fills a remote entry's counts, and drops one missing a field with no default", () => {
    const read = (remote: unknown) =>
      normalizeEvalSample({ ...row, sentinel_stats: { guard: { remote } } })
        .sentinel_stats?.["guard"]?.remote;
    expect(
      read({ proxy_url: "http://proxy", version: 1, release: "whole" })
    ).toEqual({
      proxy_url: "http://proxy",
      version: 1,
      release: "whole",
      model_calls: 0,
      unrecorded_calls: 0,
      results_withheld: null,
    });
    expect(read({ version: 1, release: "whole" })).toBeNull();
  });

  it("keeps steps that are unavailable unavailable, and leaves absent stats absent", () => {
    expect(
      normalizeEvalSample({
        ...row,
        sentinel_stats: { guard: { steps: null } },
      }).sentinel_stats?.["guard"]?.steps
    ).toBeNull();
    expect("sentinel_stats" in normalizeEvalSample(row)).toBe(false);
    expect(normalizeEvalStats({})).not.toHaveProperty("sentinel_stats");
  });
});
