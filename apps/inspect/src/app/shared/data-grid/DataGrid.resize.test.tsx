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
  vi.unstubAllGlobals();
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

  test("body cells follow new column defs at unchanged widths", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(500);
    // e.g. toggling heat-map colours rebuilds defs with a new cellStyle.
    const colored = makeAbcColumns().map((c) => ({
      ...c,
      meta: { cellStyle: () => ({ color: "red" }) },
    }));
    const props = {
      data: abcRows,
      getRowId: (r: AbcRow) => r.id,
      onRowActivate: () => {},
      columnVisibility: { a: true, b: true, c: true },
    };
    const { rerender } = render(
      <DataGrid<AbcRow> {...props} columns={makeAbcColumns()} />
    );
    rerender(<DataGrid<AbcRow> {...props} columns={colored} />);
    const colors = screen
      .getAllByRole("gridcell")
      .map((el) => (el instanceof HTMLElement ? el.style.color : ""));
    expect(colors).toEqual(["red", "red", "red"]);
  });

  test("an override outside the column's bounds still fits the container", () => {
    // jsdom has no ResizeObserver or layout; the grid reads the container
    // width once on mount, so a no-op observer plus clientWidth suffices.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    // 500px to fit into, after the grid's 4px `kFitSlack` reserve.
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(504);
    const fitColumns: ExtendedColumnDef<AbcRow>[] = [
      {
        id: "a",
        header: "A",
        size: 96,
        minSize: 60,
        maxSize: 120,
        accessorFn: (r) => r.a,
      },
      {
        id: "b",
        header: "B",
        size: 200,
        minSize: 150,
        flex: 1,
        accessorFn: (r) => r.b,
      },
    ];
    render(
      <DataGrid<AbcRow>
        data={abcRows}
        columns={fitColumns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        columnSizing={{ a: 36 }}
        onColumnSizingChange={() => {}}
      />
    );
    const headerWidths = screen
      .getAllByRole("columnheader")
      .map((el) =>
        el instanceof HTMLElement ? parseFloat(el.style.width) : 0
      );
    expect(headerWidths).toEqual([60, 440]);
  });
});
