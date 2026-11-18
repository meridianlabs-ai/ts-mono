import { describe, expect, it } from "vitest";

import { fitColumnSizes } from "./fitColumnSizes";
import type { ColumnSizingDefinition } from "./types";

describe("fitColumnSizes", () => {
  it("falls back to default sizes when no table element", () => {
    const columns: ColumnSizingDefinition[] = [
      {
        accessorKey: "col1",
        header: "Column 1",
        size: 100,
      },
    ];

    const sizes = fitColumnSizes(null, columns, []);

    expect(sizes).toEqual({
      col1: 100,
    });
  });

  it("falls back to DEFAULT_SIZE when column has no size", () => {
    const columns: ColumnSizingDefinition[] = [
      {
        accessorKey: "col1",
        header: "Column 1",
      },
    ];

    const sizes = fitColumnSizes(null, columns, []);

    expect(sizes).toEqual({
      col1: 150, // DEFAULT_SIZE
    });
  });
});
