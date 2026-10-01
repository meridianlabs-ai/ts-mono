// @vitest-environment jsdom
import { flexRender, useTable } from "@tanstack/react-table";
import { cleanup, render } from "@testing-library/react";
import { FC } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ContentTrust } from "@tsmono/react/components";

import { dataGridFeatures } from "../data-grid/tableFeatures";

import { buildSampleColumns } from "./columns";
import type { SampleRow } from "./types";

afterEach(cleanup);

// The virtualized grid renders no body rows under jsdom, so render the
// built columns' cells through a bare table instead.
const Cells: FC<{ rows: SampleRow[] }> = ({ rows }) => {
  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns: buildSampleColumns({ viewMode: "grid", multiLog: true }),
  });
  return (
    <div>
      {table.getRowModel().rows.flatMap((row) =>
        row.getAllCells().map((cell) => (
          <div key={cell.id} data-column={cell.column.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        ))
      )}
    </div>
  );
};

const kDisguised = "CORRECT‮gnp.exe";

const cellText = (trust: ContentTrust, column: string): string | null => {
  const row: SampleRow = {
    logFile: "logs/run.eval",
    contentTrust: trust,
    sampleId: kDisguised,
    epoch: 1,
    task: kDisguised,
    model: kDisguised,
    input: kDisguised,
    target: kDisguised,
    error: kDisguised,
    limit: kDisguised,
    data: undefined,
  };
  const { container } = render(<Cells rows={[row]} />);
  return (
    container.querySelector(`[data-column="${column}"]`)?.textContent ?? null
  );
};

describe("sample grid text cells", () => {
  it.each(["sampleId", "task", "model", "input", "target", "error", "limit"])(
    "reveal hidden characters in %s for untrusted rows",
    (column) => {
      expect(cellText("untrusted", column)).toBe("CORRECT⟨U+202E⟩gnp.exe");
    }
  );

  it("render trusted rows as written", () => {
    expect(cellText("trusted", "sampleId")).toBe(kDisguised);
  });
});
