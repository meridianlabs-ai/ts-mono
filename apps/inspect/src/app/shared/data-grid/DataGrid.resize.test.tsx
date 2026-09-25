// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ExtendedColumnDef } from "./columnTypes";
import { DataGrid } from "./DataGrid";
import { abcRows, makeAbcColumns, type AbcRow } from "./testFixtures";

// Vitest globals aren't enabled in this app, so RTL's automatic afterEach
// cleanup never fires. Run it explicitly.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [{ id: "1", name: "alpha" }];

const columns: ExtendedColumnDef<Row>[] = [
  {
    id: "icon",
    header: "",
    size: 32,
    enableResizing: false,
    accessorFn: (r) => r.id,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
  {
    id: "name",
    header: "Name",
    size: 200,
    accessorFn: (r) => r.name,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
];

describe("DataGrid column resizing", () => {
  test("renders a resize handle only for resizable columns", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    const handles = screen.getAllByRole("separator");
    expect(handles).toHaveLength(1);
    expect(screen.getByLabelText("Resize name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Resize icon")).not.toBeInTheDocument();
  });

  test("renders a resize handle for a rotated (compact score) header", () => {
    const rotatedCols: ExtendedColumnDef<Row>[] = [
      {
        id: "score",
        header: "Score",
        size: 40,
        meta: { rotateHeader: true },
        accessorFn: (r) => r.name,
        cell: ({ getValue }) => <div>{getValue<string>()}</div>,
      },
    ];
    render(
      <DataGrid<Row>
        data={rows}
        columns={rotatedCols}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    expect(screen.getByLabelText("Resize score")).toBeInTheDocument();
  });

  test("body cells follow a width change that keeps the total width", () => {
    // jsdom has no layout; give the virtualizer a viewport so rows render.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(500);
    const cellWidths = (role: string) =>
      screen
        .getAllByRole(role)
        .map((el) => (el instanceof HTMLElement ? el.style.width : ""));
    // Real callers pass a stable visibility map; resizing against flex
    // columns shifts widths between columns without changing the total.
    const props = {
      data: abcRows,
      columns: makeAbcColumns(),
      getRowId: (r: AbcRow) => r.id,
      onRowActivate: () => {},
      columnVisibility: { a: true, b: true, c: true },
      onColumnSizingChange: () => {},
    };
    const { rerender } = render(
      <DataGrid<AbcRow> {...props} columnSizing={{}} />
    );
    expect(cellWidths("gridcell")).toEqual(["100px", "100px", "100px"]);

    rerender(
      <DataGrid<AbcRow> {...props} columnSizing={{ a: 200, b: 50, c: 50 }} />
    );
    expect(cellWidths("columnheader")).toEqual(["200px", "50px", "50px"]);
    expect(cellWidths("gridcell")).toEqual(["200px", "50px", "50px"]);
  });
});
