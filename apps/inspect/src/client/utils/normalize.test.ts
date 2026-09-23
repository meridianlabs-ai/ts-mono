import { describe, expect, it } from "vitest";

import {
  normalizeEvalHeader,
  normalizeEvalLog,
  normalizeLogListing,
  normalizeLogPreview,
  normalizeLogStart,
} from "./normalize";

const minimalEval = {
  task: "demo",
  task_id: "t1",
  run_id: "r1",
  created: "2024-11-05T13:32:37-05:00",
  model: "mockllm/model",
  dataset: {},
  config: {},
};

describe("normalizeEvalHeader", () => {
  it.each([normalizeEvalHeader, normalizeEvalLog])(
    "normalizes stats at both header and whole-log boundaries",
    (normalize) => {
      const result = normalize({
        eval: minimalEval,
        stats: { connection_limit_history: [null] },
      });
      expect(result.stats?.connection_limit_history).toEqual([]);
      expect(result.stats?.connectionHistoryError).toMatch(
        "Invalid connection history"
      );
      expect(result.eval.task).toBe("demo");
    }
  );

  it("throws on non-object input", () => {
    expect(() => normalizeEvalHeader("bad")).toThrow();
    expect(() => normalizeEvalHeader(null)).toThrow();
  });

  it("fills version/status and normalizes eval + plan", () => {
    const header = normalizeEvalHeader({ eval: minimalEval });
    expect(header.version).toBe(2);
    expect(header.status).toBe("started");
    expect(header.eval.task_args_passed).toEqual({});
    expect(header.plan).toEqual({ name: "plan", steps: [], config: {} });
    expect(header.results).toBeNull();
  });

  it("derives tags/metadata from the spec when absent (recompute mirror)", () => {
    const header = normalizeEvalHeader({
      eval: { ...minimalEval, tags: ["x"], metadata: { reviewer: "a" } },
    });
    expect(header.tags).toEqual(["x"]);
    expect(header.metadata).toEqual({ reviewer: "a" });
  });

  it("prefers explicit log-level tags/metadata over the spec's", () => {
    const header = normalizeEvalHeader({
      eval: { ...minimalEval, tags: ["spec"] },
      tags: ["log"],
      metadata: { from: "log" },
    });
    expect(header.tags).toEqual(["log"]);
    expect(header.metadata).toEqual({ from: "log" });
  });

  it("fills stats usage defaults and drops malformed usage entries", () => {
    const header = normalizeEvalHeader({
      eval: minimalEval,
      stats: {
        model_usage: {
          "openai/gpt-4": { input_tokens: 1, output_tokens: 2 },
          "openai/gpt-3.5": null,
        },
      },
    });
    expect(header.stats?.model_usage).toEqual({
      "openai/gpt-4": { input_tokens: 1, output_tokens: 2, total_tokens: 0 },
    });
    expect(header.stats?.role_usage).toEqual({});
    expect(header.stats?.started_at).toBe("");
    expect(normalizeEvalHeader({ eval: minimalEval }).stats).toBeUndefined();
  });

  it("preserves fields it doesn't model (future schema growth)", () => {
    const header = normalizeEvalHeader({
      eval: minimalEval,
      some_future_field: { nested: true },
    });
    expect(header).toMatchObject({ some_future_field: { nested: true } });
  });

  it("normalizes config_updates, dropping malformed entries", () => {
    const header = normalizeEvalHeader({
      eval: minimalEval,
      config_updates: [
        { changes: "bad" },
        {
          scope: "task",
          provenance: { timestamp: "t", author: "a", metadata: {} },
          changes: [{ name: "max_samples", config: "eval", value: 2 }],
        },
      ],
    });
    expect(header.config_updates).toHaveLength(1);
    expect(header.config_updates?.[0]?.changes[0]?.previous).toBeNull();
  });
});

describe("normalizeLogStart", () => {
  it("fills version and normalizes eval + plan", () => {
    const start = normalizeLogStart({ eval: minimalEval });
    expect(start.version).toBe(2);
    expect(start.eval.task_args_passed).toEqual({});
    expect(start.plan.name).toBe("plan");
  });

  it("throws on non-object input", () => {
    expect(() => normalizeLogStart(undefined)).toThrow();
  });
});

describe("normalizeEvalLog", () => {
  it("fills log-level defaults and normalizes samples", () => {
    const log = normalizeEvalLog({
      eval: minimalEval,
      samples: [
        {
          id: 1,
          epoch: 1,
          input: "q",
          events: [{ event: "model", timestamp: "t", model: "m" }],
        },
      ],
    });
    expect(log.version).toBe(2);
    expect(log.status).toBe("started");
    expect(log.invalidated).toBe(false);
    const event = log.samples?.[0]?.events[0];
    expect(event?.working_start).toBe(0);
    expect(event?.event === "model" && event.config).toEqual({});
  });

  it("preserves log-level fields it doesn't model", () => {
    const log = normalizeEvalLog({
      eval: minimalEval,
      some_future_field: 7,
    });
    expect(log).toMatchObject({ some_future_field: 7 });
  });

  it("leaves samples absent when the file carries none (header-only log)", () => {
    const log = normalizeEvalLog({ eval: minimalEval });
    expect(log.samples).toBeUndefined();
  });

  it("migrates v1 logs: results.scorer → scores[], sample.score → scores map", () => {
    const log = normalizeEvalLog({
      version: 1,
      eval: minimalEval,
      results: {
        total_samples: 2,
        completed_samples: 2,
        scorer: { name: "match", params: {} },
        metrics: { accuracy: { name: "accuracy", value: 0.5, params: {} } },
      },
      samples: [{ id: 1, epoch: 1, input: "q", score: { value: "C" } }],
    });
    expect(log.results?.scores).toEqual([
      {
        name: "match",
        scorer: "match",
        params: {},
        metrics: { accuracy: { name: "accuracy", value: 0.5, params: {} } },
      },
    ]);
    expect(log.samples?.[0]?.scores).toEqual({ match: { value: "C" } });
    expect(log.samples?.[0] && "score" in log.samples[0]).toBe(false);
  });

  it("leaves v2 logs untouched by the v1 migration", () => {
    const log = normalizeEvalLog({
      version: 2,
      eval: minimalEval,
      results: { scores: [{ name: "match", scorer: "match" }] },
    });
    expect(log.results?.scores).toHaveLength(1);
  });
});

// The shape inspect_ai 0.3.150 writes to listing.json: no `error`,
// `model_roles`, `invalidated`, and `primary_metric` only when scored.
const legacyOverview = {
  eval_id: "TcENcn2QPtcgSkeNc5nSbj",
  run_id: "DSwRm98qw3sm8uTY6hCWhk",
  task: "solo_agent",
  task_id: "KLVSy7Dn9tHf7WCHbFmbPY",
  task_version: 0,
  version: 2,
  status: "success",
  model: "openai/gpt-4o-mini",
  started_at: "2024-11-21T07:19:57-08:00",
  completed_at: "2024-11-21T08:22:27-08:00",
};

describe("normalizeLogPreview", () => {
  it("throws on non-object input", () => {
    expect(() => normalizeLogPreview("bad")).toThrow();
    expect(() => normalizeLogPreview(null)).toThrow();
  });

  it("passes a legacy overview through, leaving absent fields absent", () => {
    const preview = normalizeLogPreview(legacyOverview);
    expect(preview).toEqual(legacyOverview);
    expect("error" in preview).toBe(false);
    expect("model_roles" in preview).toBe(false);
    expect("primary_metric" in preview).toBe(false);
  });

  it("passes provided optional fields through unchanged", () => {
    const error = { message: "boom", traceback: "tb", traceback_ansi: "tb" };
    const primary_metric = { name: "accuracy", value: 0.5, params: {} };
    const preview = normalizeLogPreview({
      ...legacyOverview,
      error,
      model_roles: { grader: "openai/gpt-4o" },
      primary_metric,
    });
    expect(preview.error).toBe(error);
    expect(preview.model_roles).toEqual({ grader: "openai/gpt-4o" });
    expect(preview.primary_metric).toBe(primary_metric);
  });

  it("fills required strings and task_version like normalizeEvalSpec", () => {
    expect(normalizeLogPreview({})).toEqual({
      eval_id: "--",
      run_id: "",
      task: "",
      task_id: "",
      task_version: 0,
      model: "",
    });
  });

  it("synthesizes eval_id from run_id/task_id/started_at when absent", () => {
    const { eval_id: _dropped, ...noEvalId } = legacyOverview;
    const preview = normalizeLogPreview(noEvalId);
    expect(preview.eval_id).toBe(
      "DSwRm98qw3sm8uTY6hCWhk-KLVSy7Dn9tHf7WCHbFmbPY-2024-11-21T07:19:57-08:00"
    );
  });

  it("preserves fields it doesn't model (future schema growth)", () => {
    const preview = normalizeLogPreview({
      ...legacyOverview,
      invalidated: true,
      some_future_field: { nested: true },
    });
    expect(preview).toMatchObject({
      invalidated: true,
      some_future_field: { nested: true },
    });
  });
});

describe("normalizeLogListing", () => {
  it("returns an empty listing for non-object input", () => {
    expect(normalizeLogListing(undefined)).toEqual({});
    expect(normalizeLogListing("bad")).toEqual({});
    expect(normalizeLogListing([legacyOverview])).toEqual({});
  });

  it("normalizes each entry and drops non-record entries", () => {
    const listing = normalizeLogListing({
      "a.eval": legacyOverview,
      "b.eval": "corrupt",
      "c.eval": null,
    });
    expect(Object.keys(listing)).toEqual(["a.eval"]);
    expect(listing["a.eval"]).toEqual(legacyOverview);
  });
});
