/**
 * Shared fixtures and DOM helpers for DataGrid tests.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { expect } from "vitest";

import type { ExtendedColumnDef } from "./columnTypes";

/** Single-column fixture (rows r1–r3) for selection/scroll tests. */
export interface SimpleRow {
  id: string;
  a: string;
}

export const simpleRows: SimpleRow[] = [
  { id: "r1", a: "1a" },
  { id: "r2", a: "2a" },
  { id: "r3", a: "3a" },
];

export const simpleColumns: ExtendedColumnDef<SimpleRow>[] = [
  {
    id: "a",
    header: "A",
    size: 100,
    accessorFn: (r: SimpleRow) => r.a,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
];

/** Three-column fixture (single row) for reorder/pinning tests. */
export interface AbcRow {
  id: string;
  a: string;
  b: string;
  c: string;
}

export const abcRows: AbcRow[] = [{ id: "1", a: "1a", b: "1b", c: "1c" }];

export const makeAbcColumns = (
  pinnedIds: string[] = []
): ExtendedColumnDef<AbcRow>[] =>
  (["a", "b", "c"] as const).map((key) => ({
    id: key,
    header: key.toUpperCase(),
    size: 100,
    accessorFn: (r: AbcRow) => r[key],
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
    ...(pinnedIds.includes(key) ? { pinned: "start" as const } : {}),
  }));

// jsdom has no DataTransfer; provide the bits the handlers touch.
const dataTransfer = () => ({
  effectAllowed: "",
  dropEffect: "",
  setData: () => {},
  getData: () => "",
});

/** Drag the header labelled `from` and drop it on the header cell of `to`. */
export const dragHeader = async (from: string, to: string) => {
  const dt = dataTransfer();
  const source = screen.getByText(from);
  const target = screen.getByText(to).closest('[role="columnheader"]');
  expect(target).not.toBeNull();
  if (!target) return;
  fireEvent.dragStart(source, { dataTransfer: dt });
  // The drag-source state flip is deferred a macrotask (see DataGrid's
  // handleHeaderDragStart) — flush it before the drag proceeds.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.dragOver(target, { dataTransfer: dt });
  fireEvent.drop(target, { dataTransfer: dt });
  fireEvent.dragEnd(source, { dataTransfer: dt });
};

export const headerOrder = () =>
  screen.getAllByRole("columnheader").map((cell) => cell.textContent.trim());
