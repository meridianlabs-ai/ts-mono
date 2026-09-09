import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DataGrid } from "./DataGrid";
import type { AbcRow as Row } from "./testFixtures";
import {
  dragHeader,
  headerOrder,
  makeAbcColumns,
  abcRows as rows,
} from "./testFixtures";

// Vitest globals aren't enabled in this app, so RTL's automatic afterEach
// cleanup never fires. Run it explicitly.
afterEach(cleanup);

const columns = makeAbcColumns();

describe("DataGrid column reorder", () => {
  test("dropping a header on another column reorders and reports the order", async () => {
    const onColumnOrderChange = vi.fn();
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        onColumnOrderChange={onColumnOrderChange}
      />
    );
    expect(headerOrder()).toEqual(["A", "B", "C"]);
    await dragHeader("A", "C");
    expect(onColumnOrderChange).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  test("uncontrolled: the grid applies the new order itself", async () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    await dragHeader("C", "A");
    // Body cells follow automatically (same table state); the virtualizer
    // renders no rows in jsdom, so assert on the headers.
    expect(headerOrder()).toEqual(["C", "A", "B"]);
  });

  test("controlled: renders the supplied order without a drag", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        columnOrder={["b", "a"]}
        onColumnOrderChange={() => {}}
      />
    );
    // Ids missing from the stored order (c) append after it.
    expect(headerOrder()).toEqual(["B", "A", "C"]);
  });

  test("a self-drop changes nothing", async () => {
    const onColumnOrderChange = vi.fn();
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        onColumnOrderChange={onColumnOrderChange}
      />
    );
    await dragHeader("B", "B");
    expect(onColumnOrderChange).not.toHaveBeenCalled();
    expect(headerOrder()).toEqual(["A", "B", "C"]);
  });
});
