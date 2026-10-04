import { describe, expect, it } from "vitest";

import {
  normalizeActiveScans,
  normalizeStatus,
  normalizeTranscript,
  type WireStatus,
  type WireTranscript,
} from "./normalize";

// The shape an old inspect_scout wrote: nothing pydantic would have filled at
// read time is present.
const legacyStatus: WireStatus = {
  complete: true,
  location: "/scans/scan-1",
  spec: {
    scan_id: "scan-1",
    scan_name: "legacy",
    timestamp: "2025-01-01T00:00:00Z",
    scanners: { s1: { name: "s1" } },
  },
};

describe("normalizeStatus", () => {
  const status = normalizeStatus(legacyStatus);

  it("fills the summary a legacy status omits", () => {
    expect(status.summary).toEqual({ complete: true, scanners: {} });
    expect(status.errors).toEqual([]);
  });

  it("fills spec defaults: packages, options, scanner params/version", () => {
    expect(status.spec.packages).toEqual({});
    expect(status.spec.options).toEqual({ max_transcripts: 25 });
    expect(status.spec.scanners["s1"]).toEqual({
      name: "s1",
      params: {},
      version: 0,
    });
  });

  it("fills scanner-summary counters and model usage", () => {
    const normalized = normalizeStatus({
      ...legacyStatus,
      summary: {
        scanners: {
          s1: { model_usage: { m: { input_tokens: 3 } } },
        },
      },
    });
    expect(normalized.summary.scanners["s1"]).toEqual({
      errors: 0,
      results: 0,
      scans: 0,
      tokens: 0,
      model_usage: {
        m: { input_tokens: 3, output_tokens: 0, total_tokens: 0 },
      },
      validation: undefined,
    });
  });

  it("fills validation entries and metric counters, nulling ratios", () => {
    const normalized = normalizeStatus({
      ...legacyStatus,
      summary: {
        scanners: {
          s1: {
            validation: {
              metrics: { tp: 2, fn: 1 },
              metrics_by_key: { label: { tn: 4 } },
            },
          },
        },
      },
    });
    const validation = normalized.summary.scanners["s1"]?.validation;
    expect(validation?.entries).toEqual([]);
    expect(validation?.metrics).toEqual({
      tp: 2,
      fp: 0,
      tn: 0,
      fn: 1,
      total: 3,
      accuracy: null,
      precision: null,
      recall: null,
      f1: null,
      specificity: null,
    });
    expect(validation?.metrics_by_key?.["label"]).toMatchObject({
      tn: 4,
      total: 4,
      recall: null,
    });
  });

  it("preserves everything a current-format status carries", () => {
    const current: WireStatus = {
      complete: false,
      location: "/scans/scan-2",
      errors: [
        {
          error: "boom",
          refusal: false,
          scanner: "s1",
          traceback: "",
          transcript_id: "t1",
        },
      ],
      spec: {
        scan_id: "scan-2",
        scan_name: "current",
        timestamp: "2026-01-01T00:00:00Z",
        packages: { inspect_scout: "1.0" },
        options: { max_transcripts: 5, limit: 10 },
        scanners: { s1: { name: "s1", params: { k: 1 }, version: 2 } },
        tags: ["a"],
      },
      summary: {
        complete: false,
        scanners: {
          s1: {
            errors: 1,
            results: 2,
            scans: 3,
            tokens: 4,
            model_usage: {},
            metrics: { s1: { mean: 0.5 } },
            validation: {
              entries: [{ id: "t1", target: true, valid: true }],
              metrics: {
                tp: 1,
                fp: 0,
                tn: 0,
                fn: 0,
                total: 1,
                accuracy: 1,
                precision: 1,
                recall: 1,
                f1: 1,
                specificity: null,
              },
            },
          },
        },
      },
    };
    expect(normalizeStatus(current)).toEqual(current);
  });
});

describe("normalizeActiveScans", () => {
  it("fills a missing items map and each scan's summary", () => {
    expect(normalizeActiveScans({})).toEqual({ items: {} });
    const normalized = normalizeActiveScans({
      items: {
        a: {
          config: "c",
          last_updated: 1,
          location: "/a",
          metrics: {
            batch_failures: 0,
            batch_pending: 0,
            buffered_scanner_jobs: 0,
            completed_scans: 0,
            memory_usage: 0,
            process_count: 0,
            task_count: 0,
            tasks_idle: 0,
            tasks_parsing: 0,
            tasks_scanning: 0,
          },
          scan_id: "a",
          scanner_names: ["s1"],
          start_time: 0,
          title: "a",
          total_scans: 1,
          summary: { scanners: { s1: { validation: {} } } },
        },
      },
    });
    expect(normalized.items["a"]?.summary).toEqual({
      complete: true,
      scanners: {
        s1: {
          errors: 0,
          results: 0,
          scans: 0,
          tokens: 0,
          model_usage: {},
          validation: {
            entries: [],
            metrics: undefined,
            metrics_by_key: undefined,
          },
        },
      },
    });
  });
});

describe("normalizeTranscript", () => {
  // A stored transcript from before messages/timelines/metadata were written
  // (and whose events predate working_start).
  const legacyTranscript: WireTranscript = {
    transcript_id: "t1",
    events: [{ event: "step", action: "begin", name: "solve" }],
  };

  it("fills the lists and metadata a legacy transcript omits", () => {
    const transcript = normalizeTranscript(legacyTranscript);
    expect(transcript.messages).toEqual([]);
    expect(transcript.timelines).toEqual([]);
    expect(transcript.metadata).toEqual({});
  });

  it("normalizes events and repairs a missing or malformed events list", () => {
    expect(normalizeTranscript(legacyTranscript).events).toMatchObject([
      { event: "step", working_start: 0, timestamp: "" },
    ]);
    expect(normalizeTranscript({ transcript_id: "t2" }).events).toEqual([]);
    expect(
      normalizeTranscript({ transcript_id: "t3", events: "oops" }).events
    ).toEqual([]);
  });

  it("drops timelines that aren't records with a root span", () => {
    expect(
      normalizeTranscript({ transcript_id: "t4", timelines: "oops" }).timelines
    ).toEqual([]);
    const transcript = normalizeTranscript({
      transcript_id: "t5",
      timelines: [{ nope: true }, { root: { id: "r" } }],
    });
    expect(transcript.timelines).toMatchObject([
      {
        root: {
          id: "r",
          type: "span",
          tool_invoked: false,
          utility: false,
          branches: [],
          content: [],
        },
      },
    ]);
  });

  it("expands condensed events through events_data", () => {
    const transcript = normalizeTranscript(
      {
        transcript_id: "t4",
        events: [
          {
            event: "model",
            timestamp: "t",
            model: "m",
            working_start: 0,
            input: [],
            input_refs: [[0, 1]],
          },
        ],
      },
      { messages: [{ id: "m1", role: "user", content: "hi" }], calls: [] }
    );
    expect(transcript.events[0]).toMatchObject({
      event: "model",
      input: [{ id: "m1", role: "user", content: "hi" }],
      input_refs: null,
    });
  });

  it("preserves a current-format transcript's fields", () => {
    const current: WireTranscript = {
      transcript_id: "t5",
      metadata: { k: "v" },
      messages: [{ id: "m1", role: "user", content: "hi" }],
      timelines: [],
      events: [],
      model: "gpt",
      error: null,
    };
    expect(normalizeTranscript(current)).toEqual(current);
  });
});
