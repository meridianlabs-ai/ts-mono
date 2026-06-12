import { renderHook } from "@testing-library/react";
import type { ColumnResizedEvent } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGridColumnRefit } from "./useGridColumnRefit";

const makeGridRef = () => {
  const sizeColumnsToFit = vi.fn();
  const gridRef = {
    current: { api: { sizeColumnsToFit } },
  } as unknown as RefObject<AgGridReact<unknown> | null>;
  return { gridRef, sizeColumnsToFit };
};

const resizedEvent = (
  source: string,
  finished: boolean
): ColumnResizedEvent<unknown> =>
  ({ source, finished }) as ColumnResizedEvent<unknown>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGridColumnRefit", () => {
  it("fits columns to the grid width when refit is requested", () => {
    const { gridRef, sizeColumnsToFit } = makeGridRef();
    const { result } = renderHook(() => useGridColumnRefit(gridRef));
    result.current.refitColumns();
    vi.advanceTimersByTime(50);
    expect(sizeColumnsToFit).toHaveBeenCalledTimes(1);
  });

  it("debounces bursts of refit requests into one fit", () => {
    const { gridRef, sizeColumnsToFit } = makeGridRef();
    const { result } = renderHook(() => useGridColumnRefit(gridRef));
    result.current.refitColumns();
    result.current.refitColumns();
    result.current.refitColumns();
    vi.advanceTimersByTime(50);
    expect(sizeColumnsToFit).toHaveBeenCalledTimes(1);
  });

  it("stops auto-fitting once the user manually resizes a column", () => {
    const { gridRef, sizeColumnsToFit } = makeGridRef();
    const { result } = renderHook(() => useGridColumnRefit(gridRef));
    result.current.handleColumnResized(resizedEvent("uiColumnResized", true));
    result.current.refitColumns();
    vi.advanceTimersByTime(50);
    expect(sizeColumnsToFit).not.toHaveBeenCalled();
  });

  it("suppresses a pending refit when a user resize lands mid-debounce", () => {
    const { gridRef, sizeColumnsToFit } = makeGridRef();
    const { result } = renderHook(() => useGridColumnRefit(gridRef));
    result.current.refitColumns();
    result.current.handleColumnResized(resizedEvent("uiColumnResized", false));
    vi.advanceTimersByTime(50);
    expect(sizeColumnsToFit).not.toHaveBeenCalled();
  });

  it("keeps auto-fitting after grid-initiated resize events", () => {
    const { gridRef, sizeColumnsToFit } = makeGridRef();
    const { result } = renderHook(() => useGridColumnRefit(gridRef));
    result.current.handleColumnResized(resizedEvent("sizeColumnsToFit", true));
    result.current.handleColumnResized(resizedEvent("flex", true));
    result.current.handleColumnResized(resizedEvent("autosizeColumns", true));
    result.current.refitColumns();
    vi.advanceTimersByTime(50);
    expect(sizeColumnsToFit).toHaveBeenCalledTimes(1);
  });
});
