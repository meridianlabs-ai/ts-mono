import { describe, expect, it } from "vitest";

import { clampSize, getColumnId, type ColumnSizingDefinition } from "./types";

describe("clampSize", () => {
  const constraints = { minSize: 50, maxSize: 200 };

  it("returns size unchanged when within constraints", () => {
    expect(clampSize(100, constraints)).toBe(100);
  });

  it("returns size at minSize boundary", () => {
    expect(clampSize(50, constraints)).toBe(50);
  });

  it("returns size at maxSize boundary", () => {
    expect(clampSize(200, constraints)).toBe(200);
  });

  it("clamps to minSize when below minimum", () => {
    expect(clampSize(30, constraints)).toBe(50);
  });

  it("clamps to maxSize when above maximum", () => {
    expect(clampSize(300, constraints)).toBe(200);
  });

  it("clamps negative values to minSize", () => {
    expect(clampSize(-10, constraints)).toBe(50);
  });

  it("uses the default min and max when the column sets neither", () => {
    expect(clampSize(10, {})).toBe(40); // DEFAULT_MIN_SIZE
    expect(clampSize(1000, {})).toBe(600); // DEFAULT_MAX_SIZE
  });
});

describe("getColumnId", () => {
  it("returns accessorKey when available", () => {
    const column: ColumnSizingDefinition = {
      accessorKey: "test_key",
      header: "Test",
    };

    expect(getColumnId(column)).toBe("test_key");
  });

  it("returns id when accessorKey not available", () => {
    const column: ColumnSizingDefinition = {
      id: "custom_id",
      header: "Test",
    };

    expect(getColumnId(column)).toBe("custom_id");
  });

  it("prefers id over accessorKey when both present", () => {
    const column: ColumnSizingDefinition = {
      id: "custom_id",
      accessorKey: "accessor_key",
      header: "Test",
    };

    // id takes precedence since it's checked first
    expect(getColumnId(column)).toBe("custom_id");
  });

  it("returns empty string when neither id nor accessorKey present", () => {
    const column: ColumnSizingDefinition = {
      id: "",
      header: "Test",
    };

    expect(getColumnId(column)).toBe("");
  });
});
