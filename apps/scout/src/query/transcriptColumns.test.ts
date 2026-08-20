import { describe, expect, it } from "vitest";

import { Column } from "@tsmono/inspect-common/query";

import { transcriptColumns } from "./index";
import { TranscriptColumns } from "./transcriptColumns";

// The proxy resolves arbitrary field names to Columns at runtime (and blocks
// underscore-prefixed ones); the class type only declares the predefined
// columns, so widen with an index signature for dynamic access.
const dynamic = transcriptColumns as TranscriptColumns &
  Record<string, Column | undefined>;

describe("transcriptColumns", () => {
  it("builds conditions from predefined columns", () => {
    expect(transcriptColumns.model.eq("gpt-4").toJSON()).toEqual({
      is_compound: false,
      left: "model",
      operator: "=",
      right: "gpt-4",
    });
  });

  it("exposes predefined columns as Column instances", () => {
    expect(transcriptColumns.score.gt(0.8).toJSON()).toMatchObject({
      left: "score",
      operator: ">",
      right: 0.8,
    });
  });

  it("creates columns for arbitrary fields via the proxy", () => {
    expect(dynamic.custom_field!.eq("value").toJSON()).toEqual({
      is_compound: false,
      left: "custom_field",
      operator: "=",
      right: "value",
    });
  });

  it("supports JSON paths via field()", () => {
    expect(
      transcriptColumns.field("metadata.task.id").eq(123).toJSON()
    ).toEqual({
      is_compound: false,
      left: "metadata.task.id",
      operator: "=",
      right: 123,
    });
  });

  it("blocks access to private members through the proxy", () => {
    expect(dynamic._instance).toBeUndefined();
  });

  it("returns a shared singleton instance", () => {
    expect(TranscriptColumns.instance).toBe(transcriptColumns);
  });
});
