// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComponentProps } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ColumnSelectorPopover,
  type PickerColumn,
} from "./ColumnSelectorPopover";

afterEach(cleanup);

const columns: PickerColumn[] = [
  { id: "task", label: "Task" },
  { id: "model", label: "Model" },
  { id: "score_acc/mean", label: "acc" },
];

const renderPicker = (
  props: Partial<ComponentProps<typeof ColumnSelectorPopover>> = {}
) => {
  const onVisibilityChange = vi.fn();
  render(
    <ColumnSelectorPopover
      id="picker"
      showing
      setShowing={() => {}}
      positionEl={document.body}
      columns={columns}
      visibility={{ model: false }}
      onVisibilityChange={onVisibilityChange}
      {...props}
    />
  );
  return onVisibilityChange;
};

describe("ColumnSelectorPopover", () => {
  test("toggling a column reports the full map, treating unmapped columns as visible", () => {
    const onVisibilityChange = renderPicker();

    screen.getByRole("checkbox", { name: "Task", checked: true });
    screen.getByRole("checkbox", { name: "Model", checked: false });

    fireEvent.click(screen.getByRole("checkbox", { name: "Model" }));
    expect(onVisibilityChange).toHaveBeenCalledWith({
      task: true,
      model: true,
      "score_acc/mean": true,
    });
  });

  test("with a scores heading, All and None apply to their own section", () => {
    const onVisibilityChange = renderPicker({ scoresHeading: "Scores" });

    screen.getByText("Base");
    screen.getByText("Scores");

    const [baseNone, scoresNone] = screen.getAllByRole("button", {
      name: "None",
    });
    fireEvent.click(scoresNone!);
    expect(onVisibilityChange).toHaveBeenLastCalledWith({
      task: true,
      model: false,
      "score_acc/mean": false,
    });

    fireEvent.click(baseNone!);
    expect(onVisibilityChange).toHaveBeenLastCalledWith({
      task: false,
      model: false,
      "score_acc/mean": true,
    });
  });

  test("without a scores heading, every column is in one list", () => {
    const onVisibilityChange = renderPicker();

    screen.getByText("Columns");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onVisibilityChange).toHaveBeenCalledWith({
      task: true,
      model: true,
      "score_acc/mean": true,
    });
  });

  test("Default appears only when the caller can reset", () => {
    renderPicker();
    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();
    cleanup();

    const onResetToDefault = vi.fn();
    renderPicker({ onResetToDefault });
    fireEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(onResetToDefault).toHaveBeenCalledOnce();
  });

  test("a filtered column warns that hiding it removes the filter", () => {
    renderPicker({
      columns: [{ id: "task", label: "Task", title: "task\nTask name" }],
      filteredFields: ["task"],
    });
    const row = screen
      .getByRole("checkbox", { name: "Task" })
      .closest("[title]");
    expect(row?.getAttribute("title")).toBe(
      "task\nTask name\nUnselecting will remove an active filter on this column"
    );
  });
});
