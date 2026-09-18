import { describe, expect, it } from "vitest";

import {
  normalizeInputType,
  normalizeJsonRecord,
  normalizeScanEvents,
  normalizeScanModelUsage,
  normalizeScanValue,
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

  it("bounds nesting depth like the other JSON columns", async () => {
    const depth = 20_000;
    const target = await normalizeValidationTarget(
      "[".repeat(depth) + "]".repeat(depth)
    );
    expect(Array.isArray(target)).toBe(true);
    expect(() => JSON.stringify(target)).not.toThrow();
  });
});

describe("normalizeJsonRecord", () => {
  it("parses JSON records", async () => {
    expect(await normalizeJsonRecord('{"model":"gpt-4"}')).toEqual({
      model: "gpt-4",
    });
  });

  it("returns an empty record for absent or non-record values", async () => {
    expect(await normalizeJsonRecord(null)).toEqual({});
    expect(await normalizeJsonRecord(undefined)).toEqual({});
    expect(await normalizeJsonRecord("[1,2]")).toEqual({});
    expect(await normalizeJsonRecord("not json {")).toEqual({});
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

describe("normalizeScanValue", () => {
  it("keeps scalar cells under their scalar tags", async () => {
    expect(await normalizeScanValue("yes", "string")).toEqual({
      value: "yes",
      valueType: "string",
    });
    expect(await normalizeScanValue(0.5, "number")).toEqual({
      value: 0.5,
      valueType: "number",
    });
    expect(await normalizeScanValue(false, "boolean")).toEqual({
      value: false,
      valueType: "boolean",
    });
    expect(await normalizeScanValue(null, "null")).toEqual({
      value: null,
      valueType: "null",
    });
  });

  it("keeps string-typed scalars from mixed scanners under their tag", async () => {
    // The server only casts the string value column when a scanner's
    // value_type is uniform; a mixed scanner delivers "0.9" tagged number.
    expect(await normalizeScanValue("0.9", "number")).toEqual({
      value: "0.9",
      valueType: "number",
    });
    expect(await normalizeScanValue("true", "boolean")).toEqual({
      value: "true",
      valueType: "boolean",
    });
  });

  it("re-tags an absent cell under a scalar tag as null", async () => {
    const expected = { value: null, valueType: "null" };
    expect(await normalizeScanValue(null, "string")).toEqual(expected);
    expect(await normalizeScanValue(undefined, "number")).toEqual(expected);
    expect(await normalizeScanValue(null, "boolean")).toEqual(expected);
  });

  it("parses array and object cells whose tag matches their shape", async () => {
    expect(await normalizeScanValue("[1,2,3]", "array")).toEqual({
      value: [1, 2, 3],
      valueType: "array",
    });
    const nested = '{"a":{"b":{"c":{"d":{"e":1}}}}}';
    expect(await normalizeScanValue(nested, "object")).toEqual({
      value: { a: { b: { c: { d: { e: 1 } } } } },
      valueType: "object",
    });
  });

  // The value_type column is scan-authored independently of the value cell;
  // consumers narrow on the tag alone, so a disagreeing pair must not survive
  // normalization.
  it("re-tags an array-tagged cell that is not an array as null", async () => {
    const expected = { value: null, valueType: "null" };
    expect(await normalizeScanValue("{}", "array")).toEqual(expected);
    expect(await normalizeScanValue('{"a":1}', "array")).toEqual(expected);
    expect(await normalizeScanValue(undefined, "array")).toEqual(expected);
    expect(await normalizeScanValue(null, "array")).toEqual(expected);
    expect(await normalizeScanValue("not json {", "array")).toEqual(expected);
    expect(await normalizeScanValue("42", "array")).toEqual(expected);
  });

  it("re-tags an object-tagged cell that is not a record as null", async () => {
    const expected = { value: null, valueType: "null" };
    expect(await normalizeScanValue("[1,2]", "object")).toEqual(expected);
    expect(await normalizeScanValue("null", "object")).toEqual(expected);
    expect(await normalizeScanValue(undefined, "object")).toEqual(expected);
    expect(await normalizeScanValue("not json {", "object")).toEqual(expected);
  });

  it("bounds nesting depth so render-time stringify cannot overflow", async () => {
    const depth = 20_000;
    const cell = "[".repeat(depth) + "]".repeat(depth);
    const { value, valueType } = await normalizeScanValue(cell, "array");
    expect(valueType).toBe("array");
    expect(Array.isArray(value)).toBe(true);
    expect(() => JSON.stringify(value)).not.toThrow();

    // 8,000 levels: still overflows a recursive stringify, and the cell stays
    // under asyncJsonParse's 50KB worker threshold so it parses in-process.
    const objectDepth = 8_000;
    const objectCell =
      '{"k":'.repeat(objectDepth) + "1" + "}".repeat(objectDepth);
    const nested = await normalizeScanValue(objectCell, "object");
    expect(nested.valueType).toBe("object");
    expect(() => JSON.stringify(nested.value)).not.toThrow();
  });
});
