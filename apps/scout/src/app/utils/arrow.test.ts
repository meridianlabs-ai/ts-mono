// @no-unsafe-eval: hosts may serve Scout under a CSP without it.
import { table } from "arquero";
import { describe, expect, it } from "vitest";

import { expandResultsetRows } from "./arrow";
import { rowRecords } from "./arrowCells";

describe("expandResultsetRows", () => {
  it("gives an all-resultset scan the columns of its results", async () => {
    const expanded = await expandResultsetRows(
      table({
        uuid: ["scan-1"],
        value_type: ["resultset"],
        value: [
          JSON.stringify([
            { uuid: "r-1", label: "alpha", value: true, answer: "yes" },
            { uuid: "r-2", label: "beta", value: 2, explanation: "why" },
          ]),
        ],
      })
    );

    expect(expanded.columnNames()).toEqual(
      expect.arrayContaining(["label", "answer", "explanation"])
    );
    expect(
      rowRecords(expanded).map(
        ({ identifier, label, answer, explanation }) => ({
          identifier,
          label,
          answer,
          explanation,
        })
      )
    ).toEqual([
      { identifier: "r-1", label: "alpha", answer: "yes", explanation: null },
      { identifier: "r-2", label: "beta", answer: null, explanation: "why" },
    ]);
  });
});
