// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestWrapper } from "../../test/test-utils";

import { useAddFilterPopover } from "./columnFilter";
import { FilterBar } from "./FilterBar";

afterEach(cleanup);

const columns = [
  { id: "model", label: "Model" },
  { id: "agent", label: "Agent" },
  { id: "score", label: "Score" },
];
const defaultVisibleColumns = ["model", "score"];

const Harness = ({ onChange }: { onChange: (columns: string[]) => void }) => {
  const [visibleColumns, setVisibleColumns] = useState(["score"]);
  const addFilterPopoverState = useAddFilterPopover({
    columns: [],
    filters: {},
    onAddFilter: () => {},
  });
  return (
    <FilterBar
      filters={{}}
      onFilterChange={() => {}}
      onRemoveFilter={() => {}}
      addFilterPopoverState={addFilterPopoverState}
      columns={columns}
      visibleColumns={visibleColumns}
      defaultVisibleColumns={defaultVisibleColumns}
      onVisibleColumnsChange={(next) => {
        onChange(next);
        setVisibleColumns(next);
      }}
    />
  );
};

const openPicker = () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />, { wrapper: createTestWrapper() });
  fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
  return onChange;
};

const checkbox = (name: string) => screen.getByRole("checkbox", { name });

describe("FilterBar column picker", () => {
  test("shows the stored visible columns as checked", () => {
    openPicker();
    screen.getByRole("checkbox", { name: "Model", checked: false });
    screen.getByRole("checkbox", { name: "Agent", checked: false });
    screen.getByRole("checkbox", { name: "Score", checked: true });
  });

  test("toggling writes the visible columns in column order", () => {
    const onChange = openPicker();

    fireEvent.click(checkbox("Model"));
    expect(onChange).toHaveBeenLastCalledWith(["model", "score"]);

    fireEvent.click(checkbox("Score"));
    expect(onChange).toHaveBeenLastCalledWith(["model"]);

    fireEvent.click(checkbox("Score"));
    expect(onChange).toHaveBeenLastCalledWith(["model", "score"]);
  });

  test("All, None and Default write every, no and the default columns", () => {
    const onChange = openPicker();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith(["model", "agent", "score"]);

    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    screen.getByRole("checkbox", { name: "Score", checked: false });

    fireEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(onChange).toHaveBeenLastCalledWith(defaultVisibleColumns);
    screen.getByRole("checkbox", { name: "Model", checked: true });
  });
});
