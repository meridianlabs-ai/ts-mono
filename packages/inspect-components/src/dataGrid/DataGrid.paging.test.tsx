// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ExtendedColumnDef } from "./columnTypes";
import { DataGrid } from "./DataGrid";

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
    id: "name",
    header: "Name",
    size: 200,
    accessorFn: (r) => r.name,
    meta: { filterable: true, filterType: "string" },
  },
];

/** jsdom has no layout: a 300px-tall list scrolled to 100px from its end. */
const stubNearEnd = () => {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1000);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.spyOn(Element.prototype, "scrollTop", "get").mockReturnValue(600);
};

describe("DataGrid paging and filter suggestions", () => {
  test("asks for more rows near the end while more are available", () => {
    stubNearEnd();
    const onScrollNearEnd = vi.fn();
    const props = {
      data: rows,
      columns,
      getRowId: (r: Row) => r.id,
      onRowActivate: () => {},
      onScrollNearEnd,
      fetchThreshold: 500,
    };
    const { rerender } = render(<DataGrid<Row> {...props} hasMore={false} />);
    expect(onScrollNearEnd).not.toHaveBeenCalled();
    rerender(<DataGrid<Row> {...props} hasMore />);
    expect(onScrollNearEnd).toHaveBeenLastCalledWith(100);
  });

  test("a column filter reports opening and lists the suggestions", () => {
    const onFilterOpenChange = vi.fn();
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
        filterSuggestions={["gpt-4", "claude"]}
        onFilterOpenChange={onFilterOpenChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter name" }));
    expect(onFilterOpenChange).toHaveBeenLastCalledWith("name");
    fireEvent.click(screen.getByRole("button", { name: "Show all options" }));
    expect(screen.getByRole("option", { name: "claude" })).toBeTruthy();
  });
});
