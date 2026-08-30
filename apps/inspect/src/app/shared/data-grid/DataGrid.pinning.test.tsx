import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DataGrid } from "./DataGrid";
import type { AbcRow as Row } from "./testFixtures";
import {
  dragHeader,
  headerOrder,
  makeAbcColumns as makeColumns,
  abcRows as rows,
} from "./testFixtures";

// Vitest globals aren't enabled in this app, so RTL's automatic afterEach
// cleanup never fires. Run it explicitly.
afterEach(cleanup);

// closest() returns Element; the assertions below read HTMLElement members.
const asHtmlElement = (node: Element | null): HTMLElement => {
  if (!(node instanceof HTMLElement)) {
    throw new Error("expected an HTMLElement");
  }
  return node;
};

const headerCell = (label: string) =>
  asHtmlElement(screen.getByText(label).closest('[role="columnheader"]'));

describe("DataGrid column pinning", () => {
  test("a left-pinned column orders first regardless of definition order", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={makeColumns(["c"])}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    expect(headerOrder()).toEqual(["C", "A", "B"]);
  });

  test("pinned headers stick with cumulative offsets; unpinned do not", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={makeColumns(["a", "b"])}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    expect(headerCell("A").style.position).toBe("sticky");
    expect(headerCell("A").style.left).toBe("0px");
    expect(headerCell("B").style.position).toBe("sticky");
    expect(headerCell("B").style.left).toBe("100px");
    expect(headerCell("C").style.position).toBe("");
  });

  test("a pinned column stays first even under a controlled column order", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={makeColumns(["c"])}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        columnOrder={["b", "a", "c"]}
        onColumnOrderChange={() => {}}
      />
    );
    expect(headerOrder()).toEqual(["C", "B", "A"]);
  });

  test("a pinned header cannot be dragged", async () => {
    const onColumnOrderChange = vi.fn();
    render(
      <DataGrid<Row>
        data={rows}
        columns={makeColumns(["a"])}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        onColumnOrderChange={onColumnOrderChange}
      />
    );
    await dragHeader("A", "C");
    expect(onColumnOrderChange).not.toHaveBeenCalled();
    expect(headerOrder()).toEqual(["A", "B", "C"]);
  });

  test("dropping onto a pinned header is ignored", async () => {
    const onColumnOrderChange = vi.fn();
    render(
      <DataGrid<Row>
        data={rows}
        columns={makeColumns(["a"])}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        onColumnOrderChange={onColumnOrderChange}
      />
    );
    await dragHeader("C", "A");
    expect(onColumnOrderChange).not.toHaveBeenCalled();
    expect(headerOrder()).toEqual(["A", "B", "C"]);
  });
});
