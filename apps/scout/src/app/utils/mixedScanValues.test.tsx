// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { from, toArrowIPC } from "arquero";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentNavigationProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks } from "@tsmono/react/testing";
import { Value } from "@tsmono/scout-components/scanner-result-detail";
import { decodeArrowBytes } from "@tsmono/util";

import { ScanResultSummary } from "../types";

import { expandResultsetRows } from "./arrow";
import { rowRecords } from "./arrowCells";
import { parseScanResultSummaries } from "./arrowHelpers";
import { sortValue } from "./results";

afterEach(cleanup);

const row = (uuid: string, value: string, valueType: string) => ({
  uuid,
  value,
  value_type: valueType,
  input_type: "transcript",
  transcript_source_id: `source-${uuid}`,
  transcript_metadata: "{}",
});

// A scanner that mixes value types: the server leaves its value column as
// text, and resultset results carry their own type next to a native value.
const loadMixedScan = async (): Promise<Map<string, ScanResultSummary>> => {
  const resultset = JSON.stringify([
    { uuid: "rs-number", type: "number", value: "1" },
    { uuid: "rs-string", type: "string", value: 3 },
    { uuid: "rs-boolean", type: "boolean", value: "False" },
  ]);
  const bytes = toArrowIPC(
    from([
      row("number", "0.1234", "number"),
      row("true", "true", "boolean"),
      row("false", "false", "boolean"),
      row("text", "b", "string"),
      row("resultset", resultset, "resultset"),
    ])
  );
  const table = await expandResultsetRows(decodeArrowBytes(bytes));
  const summaries = await parseScanResultSummaries(rowRecords(table));
  return new Map(summaries.map((s) => [s.identifier, s]));
};

const renderValue = (summary: ScanResultSummary) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <Value value={summary.value} valueType={summary.valueType} />
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );

describe("mixed-type scan values through the client chain", () => {
  it("decodes text cells and resultset values to their tags", async () => {
    const byId = await loadMixedScan();
    const pairs = Object.fromEntries(
      [...byId].map(([id, s]) => [id, { value: s.value, type: s.valueType }])
    );
    expect(pairs).toEqual({
      number: { value: 0.1234, type: "number" },
      true: { value: true, type: "boolean" },
      false: { value: false, type: "boolean" },
      text: { value: "b", type: "string" },
      "rs-number": { value: 1, type: "number" },
      "rs-string": { value: 3, type: "number" },
      "rs-boolean": { value: false, type: "boolean" },
    });
  });

  it("sorts the results without throwing and orders booleans by meaning", async () => {
    const summaries = [...(await loadMixedScan()).values()];
    const sorted = [...summaries].sort(sortValue);
    const booleans = sorted
      .filter((s) => s.valueType === "boolean")
      .map((s) => s.identifier);
    expect(booleans.at(-1)).toBe("true");
  });

  it("renders every result", async () => {
    for (const summary of (await loadMixedScan()).values()) {
      expect(() => renderValue(summary), summary.identifier).not.toThrow();
      cleanup();
    }
  });
});
