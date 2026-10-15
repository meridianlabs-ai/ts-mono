// @no-unsafe-eval: hosts may serve Scout under a CSP without it.
import { QueryClient } from "@tanstack/react-query";
import { from } from "arquero";
import { describe, expect, it } from "vitest";

import { expandResultsetRows } from "../utils/arrow";

import {
  scanResultDataQuery,
  scanResultSummariesQuery,
} from "./scanResultQueries";

const scanTable = () =>
  expandResultsetRows(
    from([
      {
        uuid: "result-plain",
        transcript_id: "transcript-plain",
        value: 3,
        value_type: "number",
        label: null,
        explanation: "plain explanation",
        metadata: "{}",
        transcript_metadata: "{}",
      },
      {
        uuid: "result-set",
        transcript_id: "transcript-set",
        value: JSON.stringify([
          { uuid: "label-a", label: "alpha", value: true },
          { uuid: "label-b", label: "beta", value: 2, explanation: "beta" },
        ]),
        value_type: "resultset",
        label: null,
        explanation: null,
        metadata: "{}",
        transcript_metadata: "{}",
      },
    ])
  );

describe("scan result queries", () => {
  it("summarizes every row, resultset rows expanded", async () => {
    const summaries = await new QueryClient().query(
      scanResultSummariesQuery(await scanTable())
    );

    expect(
      summaries.map(({ identifier, label, value }) => ({
        identifier,
        label,
        value,
      }))
    ).toEqual([
      { identifier: "result-plain", label: undefined, value: 3 },
      { identifier: "label-a", label: "alpha", value: true },
      { identifier: "label-b", label: "beta", value: 2 },
    ]);
  });

  it("reads the data for one row by identifier", async () => {
    const data = await new QueryClient().query(
      scanResultDataQuery(await scanTable(), "label-b")
    );

    expect(data).toMatchObject({
      identifier: "label-b",
      uuid: "result-set",
      label: "beta",
      explanation: "beta",
      value: 2,
    });
  });

  it("answers null for an identifier with no row", async () => {
    const data = await new QueryClient().query(
      scanResultDataQuery(await scanTable(), "missing")
    );

    expect(data).toBeNull();
  });
});
