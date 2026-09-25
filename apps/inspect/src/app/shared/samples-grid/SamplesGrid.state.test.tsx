// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ExtendedColumnDef } from "../data-grid/columnTypes";

import { buildSampleColumns } from "./columns";
import { SamplesGrid } from "./SamplesGrid";
import type { SampleRow } from "./types";

// Vitest globals aren't enabled in this app, so RTL's automatic afterEach
// cleanup never fires. Run it explicitly.
afterEach(cleanup);

const rows: SampleRow[] = [
  {
    logFile: "a.eval",
    contentTrust: "trusted",
    sampleId: 2,
    epoch: 1,
    input: "banana",
  },
  {
    logFile: "a.eval",
    contentTrust: "trusted",
    sampleId: 1,
    epoch: 1,
    input: "apple",
  },
];

const columns: ExtendedColumnDef<SampleRow>[] = [
  {
    id: "input",
    header: "Input",
    size: 100,
    accessorFn: (r: SampleRow) => r.input,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
];

const getRowId = (row: SampleRow) => `${row.sampleId}-${row.epoch}`;

// jsdom's virtualizer renders no body rows, so row order is observed via
// `onDisplayedRowsChange` (fires with the post-filter/post-sort rows) and
// header sort state via `aria-sort`.
const displayedInputs = (spy: ReturnType<typeof vi.fn>): string[] => {
  const lastCall = spy.mock.calls.at(-1);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the spy is an untyped vi.fn(); these are the rows SamplesGrid passed to onDisplayedRowsChange
  const rows = (lastCall?.[0] ?? []) as SampleRow[];
  return rows.map((r) => r.input ?? "");
};

const headerFor = (label: string) =>
  screen.getByText(label).closest('[role="columnheader"]');

describe("SamplesGrid controlled sorting", () => {
  test("applies the sorting prop instead of local state", () => {
    const displayed = vi.fn();
    render(
      <SamplesGrid
        rowData={rows}
        columnDefs={columns}
        getRowId={getRowId}
        onRowOpen={() => {}}
        sorting={[{ id: "input", desc: false }]}
        onSortingChange={() => {}}
        onDisplayedRowsChange={displayed}
      />
    );
    // Ascending by input: "apple" before "banana" (natural row order is
    // banana-first, so an unsorted grid fails this).
    expect(displayedInputs(displayed)).toEqual(["apple", "banana"]);
    expect(headerFor("Input")).toHaveAttribute("aria-sort", "ascending");
  });

  test("reports header-click sort changes to the owner without applying them locally", () => {
    const onSortingChange = vi.fn();
    const displayed = vi.fn();
    render(
      <SamplesGrid
        rowData={rows}
        columnDefs={columns}
        getRowId={getRowId}
        onRowOpen={() => {}}
        sorting={[]}
        onSortingChange={onSortingChange}
        onDisplayedRowsChange={displayed}
      />
    );

    fireEvent.click(screen.getByText("Input"));

    expect(onSortingChange).toHaveBeenCalledWith([
      { id: "input", desc: false },
    ]);
    // Controlled: the grid renders from the (unchanged) prop, not the click.
    expect(displayedInputs(displayed)).toEqual(["banana", "apple"]);
  });

  test("uncontrolled fallback sorts locally from defaultSorting and header clicks", () => {
    const displayed = vi.fn();
    render(
      <SamplesGrid
        rowData={rows}
        columnDefs={columns}
        getRowId={getRowId}
        onRowOpen={() => {}}
        defaultSorting={[{ id: "input", desc: false }]}
        onDisplayedRowsChange={displayed}
      />
    );
    expect(displayedInputs(displayed)).toEqual(["apple", "banana"]);

    // A header click flips to descending locally (asc → desc).
    fireEvent.click(screen.getByText("Input"));
    expect(displayedInputs(displayed)).toEqual(["banana", "apple"]);
  });
});

describe("SamplesGrid cost column", () => {
  const costRows: SampleRow[] = [
    {
      logFile: "a.eval",
      contentTrust: "trusted",
      sampleId: 1,
      epoch: 1,
      input: "unpriced",
    },
    {
      logFile: "a.eval",
      contentTrust: "trusted",
      sampleId: 2,
      epoch: 1,
      input: "cheap",
      cost: 0.1,
    },
    {
      logFile: "a.eval",
      contentTrust: "trusted",
      sampleId: 3,
      epoch: 1,
      input: "pricey",
      cost: 0.5,
    },
  ];
  const costColumns = buildSampleColumns({
    viewMode: "grid",
    multiLog: true,
  }).filter((c) => c.id === "cost");

  test.each([
    [false, ["cheap", "pricey", "unpriced"]],
    [true, ["pricey", "cheap", "unpriced"]],
  ])("sorts samples without a cost last (desc=%s)", (desc, expected) => {
    const displayed = vi.fn();
    render(
      <SamplesGrid
        rowData={costRows}
        columnDefs={costColumns}
        getRowId={getRowId}
        onRowOpen={() => {}}
        sorting={[{ id: "cost", desc }]}
        onSortingChange={() => {}}
        onDisplayedRowsChange={displayed}
      />
    );
    expect(displayedInputs(displayed)).toEqual(expected);
  });
});
