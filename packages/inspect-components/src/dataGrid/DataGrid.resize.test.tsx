// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.queryByLabelText("Resize name")).not.toBeNull();
    expect(screen.queryByLabelText("Resize icon")).toBeNull();
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
    expect(screen.queryByLabelText("Resize score")).not.toBeNull();
  });

  test("body cells follow a width change that keeps the total width", () => {
    // jsdom has no layout; give the virtualizer a viewport so rows render.
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(500);
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
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(500);
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

describe("DataGrid keyboard column resizing", () => {
  const resizeHandle = (name: string) =>
    screen.getByLabelText(`Resize ${name}`);

  test("a resize handle is a focusable separator carrying the width", () => {
    const bounded: ExtendedColumnDef<Row>[] = [
      { ...columns[1]!, minSize: 80, maxSize: 400 },
    ];
    render(
      <DataGrid<Row>
        data={rows}
        columns={bounded}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    const handle = resizeHandle("name");
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute("aria-valuenow")).toBe("200");
    expect(handle.getAttribute("aria-valuemin")).toBe("80");
    expect(handle.getAttribute("aria-valuemax")).toBe("400");
  });

  test("a handle without a column maximum leaves aria-valuemax unset", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    expect(resizeHandle("name").hasAttribute("aria-valuemax")).toBe(false);
  });

  test("ArrowRight and ArrowLeft step the width by 10px", () => {
    const onColumnSizingChange = vi.fn();
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        columnSizing={{}}
        onColumnSizingChange={onColumnSizingChange}
      />
    );
    fireEvent.keyDown(resizeHandle("name"), { key: "ArrowRight" });
    expect(onColumnSizingChange).toHaveBeenLastCalledWith({ name: 210 });
    fireEvent.keyDown(resizeHandle("name"), { key: "ArrowLeft" });
    expect(onColumnSizingChange).toHaveBeenLastCalledWith({ name: 190 });
  });

  test("steps stop at the column's min and max", () => {
    const onColumnSizingChange = vi.fn();
    const bounded: ExtendedColumnDef<Row>[] = [
      { ...columns[1]!, minSize: 195, maxSize: 205 },
    ];
    render(
      <DataGrid<Row>
        data={rows}
        columns={bounded}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        columnSizing={{}}
        onColumnSizingChange={onColumnSizingChange}
      />
    );
    fireEvent.keyDown(resizeHandle("name"), { key: "ArrowRight" });
    expect(onColumnSizingChange).toHaveBeenLastCalledWith({ name: 205 });
    fireEvent.keyDown(resizeHandle("name"), { key: "ArrowLeft" });
    expect(onColumnSizingChange).toHaveBeenLastCalledWith({ name: 195 });
  });

  test("uncontrolled: the header and the handle follow a keyboard step", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    fireEvent.keyDown(resizeHandle("name"), { key: "ArrowRight" });
    const header = screen.getByText("Name").closest('[role="columnheader"]');
    expect(header instanceof HTMLElement ? header.style.width : "").toBe(
      "210px"
    );
    expect(resizeHandle("name").getAttribute("aria-valuenow")).toBe("210");
  });

  test("a rotated header's handle steps the width too", () => {
    const onColumnSizingChange = vi.fn();
    const rotatedCols: ExtendedColumnDef<Row>[] = [
      {
        id: "score",
        header: "Score",
        size: 40,
        meta: { rotateHeader: true },
        accessorFn: (r) => r.name,
      },
    ];
    render(
      <DataGrid<Row>
        data={rows}
        columns={rotatedCols}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        columnSizing={{}}
        onColumnSizingChange={onColumnSizingChange}
      />
    );
    fireEvent.keyDown(resizeHandle("score"), { key: "ArrowRight" });
    expect(onColumnSizingChange).toHaveBeenLastCalledWith({ score: 50 });
  });

  test("Enter on a handle doesn't open the selected row", () => {
    const onRowActivate = vi.fn();
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        selectedRowId="1"
        onRowActivate={onRowActivate}
      />
    );
    fireEvent.keyDown(resizeHandle("name"), { key: "Enter" });
    expect(onRowActivate).not.toHaveBeenCalled();
  });
});
