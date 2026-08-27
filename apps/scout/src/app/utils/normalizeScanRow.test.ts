import { describe, expect, it } from "vitest";

import {
  normalizeInputType,
  normalizeScanEvents,
  normalizeScanModelUsage,
  normalizeTranscriptMetadata,
  normalizeValidationResult,
  normalizeValidationTarget,
  resolveTranscriptIdentityFromMetadata,
} from "./normalizeScanRow";

describe("normalizeInputType", () => {
  it("keeps known input types", () => {
    expect(normalizeInputType("transcript")).toBe("transcript");
    expect(normalizeInputType("messages")).toBe("messages");
    expect(normalizeInputType("timeline")).toBe("timeline");
  });

  it("returns undefined for unknown input types rather than claiming transcript", () => {
    expect(normalizeInputType("some-future-kind")).toBeUndefined();
    expect(normalizeInputType(undefined)).toBeUndefined();
    expect(normalizeInputType(42)).toBeUndefined();
  });
});

describe("normalizeValidationResult", () => {
  it("keeps legacy raw booleans (pre Jan 7 2026 storage)", async () => {
    expect(await normalizeValidationResult(true)).toBe(true);
    expect(await normalizeValidationResult(false)).toBe(false);
  });

  it("parses JSON string booleans", async () => {
    expect(await normalizeValidationResult("true")).toBe(true);
    expect(await normalizeValidationResult("false")).toBe(false);
  });

  it("parses JSON string label records", async () => {
    expect(await normalizeValidationResult('{"a":true,"b":false}')).toEqual({
      a: true,
      b: false,
    });
  });

  it("drops non-boolean entries from label records", async () => {
    expect(await normalizeValidationResult('{"a":true,"b":null}')).toEqual({
      a: true,
    });
  });

  it("treats records with no boolean entries as never validated", async () => {
    expect(await normalizeValidationResult("{}")).toBeUndefined();
    expect(await normalizeValidationResult('{"a":null}')).toBeUndefined();
  });

  it("returns undefined for absent or unusable values", async () => {
    expect(await normalizeValidationResult(null)).toBeUndefined();
    expect(await normalizeValidationResult(undefined)).toBeUndefined();
    expect(await normalizeValidationResult("not json {")).toBeUndefined();
    expect(await normalizeValidationResult(42)).toBeUndefined();
  });
});

describe("normalizeValidationTarget", () => {
  it("parses JSON strings", async () => {
    expect(await normalizeValidationTarget('{"a":true}')).toEqual({ a: true });
    expect(await normalizeValidationTarget("true")).toBe(true);
  });

  it("keeps legacy raw scalars", async () => {
    expect(await normalizeValidationTarget(true)).toBe(true);
    expect(await normalizeValidationTarget(3)).toBe(3);
    expect(await normalizeValidationTarget(null)).toBeNull();
  });

  it("keeps unparseable strings verbatim", async () => {
    expect(await normalizeValidationTarget("not json {")).toBe("not json {");
  });

  it("returns undefined for an absent value", async () => {
    expect(await normalizeValidationTarget(undefined)).toBeUndefined();
  });
});

describe("normalizeTranscriptMetadata", () => {
  it("parses JSON records", async () => {
    expect(await normalizeTranscriptMetadata('{"model":"gpt-4"}')).toEqual({
      model: "gpt-4",
    });
  });

  it("returns an empty record for absent or non-record values", async () => {
    expect(await normalizeTranscriptMetadata(null)).toEqual({});
    expect(await normalizeTranscriptMetadata(undefined)).toEqual({});
    expect(await normalizeTranscriptMetadata("[1,2]")).toEqual({});
    expect(await normalizeTranscriptMetadata("not json {")).toEqual({});
  });
});

describe("normalizeScanModelUsage", () => {
  it("fills missing token fields with pydantic defaults", () => {
    expect(
      normalizeScanModelUsage({ "openai/gpt-4": { input_tokens: 10 } })
    ).toEqual({
      "openai/gpt-4": { input_tokens: 10, output_tokens: 0, total_tokens: 0 },
    });
  });

  it("is identity-preserving on clean input", () => {
    const clean = {
      "openai/gpt-4": { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    };
    expect(normalizeScanModelUsage(clean)).toBe(clean);
  });

  it("drops entries that are not records", () => {
    expect(
      normalizeScanModelUsage({
        bad: 7,
        good: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      })
    ).toEqual({
      good: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    });
  });

  it("returns an empty record for non-record input", () => {
    expect(normalizeScanModelUsage(undefined)).toEqual({});
    expect(normalizeScanModelUsage("nope")).toEqual({});
  });
});

describe("normalizeScanEvents", () => {
  it("keeps an absent column absent", () => {
    expect(normalizeScanEvents(undefined)).toBeUndefined();
  });

  it("fills event-level defaults on legacy events", () => {
    const events = normalizeScanEvents([
      { event: "model", timestamp: "2024-01-01T00:00:00Z" },
    ]);
    const event = events?.[0];
    if (event?.event !== "model") {
      throw new Error("expected a model event");
    }
    expect(event.working_start).toBe(0);
    expect(event.output).toEqual({ model: "", choices: [], completion: "" });
  });
});

describe("resolveTranscriptIdentityFromMetadata", () => {
  it("lifts identity from metadata when first-class fields are absent", () => {
    const data = {
      transcriptMetadata: {
        model: "gpt-4",
        task_name: "task",
        id: 7,
        epoch: 2,
      },
    };
    resolveTranscriptIdentityFromMetadata(data);
    expect(data).toMatchObject({
      transcriptModel: "gpt-4",
      transcriptTaskSet: "task",
      transcriptTaskId: 7,
      transcriptTaskRepeat: 2,
    });
  });

  it("never overwrites first-class fields (no-op on clean input)", () => {
    const data = {
      transcriptModel: "claude-3",
      transcriptTaskSet: "set",
      transcriptTaskId: "id-1",
      transcriptTaskRepeat: 1,
      transcriptMetadata: {
        model: "gpt-4",
        task_name: "task",
        id: 7,
        epoch: 2,
      },
    };
    resolveTranscriptIdentityFromMetadata(data);
    expect(data.transcriptModel).toBe("claude-3");
    expect(data.transcriptTaskSet).toBe("set");
    expect(data.transcriptTaskId).toBe("id-1");
    expect(data.transcriptTaskRepeat).toBe(1);
  });

  it("skips metadata values of the wrong type", () => {
    const data = {
      transcriptMetadata: { model: 42, epoch: "not-a-number" },
    };
    resolveTranscriptIdentityFromMetadata(data);
    expect(data).not.toHaveProperty("transcriptModel");
    expect(data).not.toHaveProperty("transcriptTaskRepeat");
  });
});
