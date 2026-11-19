// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ExtendedColumnDef } from "./columnTypes";
import { DataGrid } from "./DataGrid";

// Vitest globals aren't enabled in this app, so RTL's automatic afterEach
// cleanup never fires. Run it explicitly.
afterEach(cleanup);

interface Row {
  id: string;
  a: string;
  b: string;
}

const rows: Row[] = [
  { id: "r1", a: "1a", b: "1b" },
  { id: "r2", a: "2a", b: "2b" },
  { id: "r3", a: "3a", b: "3b" },
];

const columns: ExtendedColumnDef<Row>[] = [
  {
    id: "a",
    header: "A",
    size: 100,
    accessorFn: (r: Row) => r.a,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
  {
    id: "b",
    header: "B",
    size: 100,
    accessorFn: (r: Row) => r.b,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
];

const grid = () => screen.getByRole("grid");

// jsdom's virtualizer renders no body rows, so these assert the grid- and
// header-level ARIA (the row-level aria-rowindex is exercised by the browser
// e2e suite instead).
describe("DataGrid accessibility", () => {
  test("grid exposes an accessible name and virtualized row/col counts", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        ariaLabel="Test grid"
      />
    );

    const el = grid();
    expect(el.getAttribute("aria-label")).toBe("Test grid");
    // rows + the header row
    expect(el.getAttribute("aria-rowcount")).toBe(String(rows.length + 1));
    expect(el.getAttribute("aria-colcount")).toBe("2");
  });

  test("loading sets aria-busy and the live region announces the count", () => {
    const { rerender } = render(
      <DataGrid<Row>
        data={[]}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        loading
      />
    );

    expect(grid().getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Loading…");

    rerender(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );

    expect(grid().hasAttribute("aria-busy")).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("3 rows");
  });

  test("headers carry columnheader role, aria-colindex, and aria-sort", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        sorting={[{ id: "a", desc: true }]}
      />
    );

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(2);
    expect(headers[0]?.getAttribute("aria-colindex")).toBe("1");
    expect(headers[0]?.getAttribute("aria-sort")).toBe("descending");
    expect(headers[1]?.getAttribute("aria-colindex")).toBe("2");
    expect(headers[1]?.getAttribute("aria-sort")).toBe("none");
  });

  test("a sortable header is keyboard-operable (Enter cycles sort, not row activation)", () => {
    const onSortingChange = vi.fn();
    const onRowActivate = vi.fn();
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={onRowActivate}
        onSortingChange={onSortingChange}
      />
    );

    // The sort control is a focusable button inside the header, named by the
    // header text.
    const sortButton = screen.getByRole("button", { name: "A" });
    fireEvent.keyDown(sortButton, { key: "Enter" });

    expect(onSortingChange).toHaveBeenCalledWith([{ id: "a", desc: false }]);
    // The container's Enter handler (activate row) must not also fire.
    expect(onRowActivate).not.toHaveBeenCalled();
  });
});
