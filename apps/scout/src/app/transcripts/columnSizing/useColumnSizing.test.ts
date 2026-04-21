// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptColumn } from "../columns";

// Mock the store
const mockSetTableState = vi.fn();
const mockStoreState = {
  transcriptsTableState: {
    columnSizing: {},
    sizingStrategy: "default" as const,
    manuallyResizedColumns: [] as string[],
  },
};

vi.mock("../../../state/store", () => ({
  useStore: vi.fn((selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState)
  ),
}));

describe("useColumnSizing", () => {
  // Dynamic imports ensure modules resolve against the vi.mock above
  const loadUseStore = async () =>
    (await import("../../../state/store")).useStore as unknown as ReturnType<
      typeof vi.fn
    >;
  const loadUseColumnSizing = async () =>
    (await import("./useColumnSizing")).useColumnSizing;

  const mockColumns: TranscriptColumn[] = [
    {
      accessorKey: "col1",
      header: "Column 1",
      size: 100,
      minSize: 50,
      maxSize: 200,
    },
    {
      accessorKey: "col2",
      header: "Column 2",
      size: 150,
      minSize: 80,
      maxSize: 300,
    },
  ];

  const mockTableRef = {
    current: null,
  } as React.RefObject<HTMLTableElement | null>;

  const mockData: never[] = [];

  let useColumnSizing: Awaited<ReturnType<typeof loadUseColumnSizing>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock store state
    mockStoreState.transcriptsTableState = {
      columnSizing: {},
      sizingStrategy: "default",
      manuallyResizedColumns: [],
    };

    const useStore = await loadUseStore();
    useColumnSizing = await loadUseColumnSizing();

    // Setup useStore mock to return setTableState
    useStore.mockImplementation(
      (
        selector?: (
          state: typeof mockStoreState & {
            setTranscriptsTableState: typeof mockSetTableState;
          }
        ) => unknown
      ) => {
        if (!selector) return undefined;
        if (selector.toString().includes("setTranscriptsTableState")) {
          return mockSetTableState;
        }
        return selector(
          mockStoreState as typeof mockStoreState & {
            setTranscriptsTableState: typeof mockSetTableState;
          }
        );
      }
    );
  });

  it("returns initial column sizing state", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    expect(result.current.columnSizing).toEqual({});
    expect(result.current.sizingStrategy).toBe("default");
  });

  it("provides handleColumnSizingChange function", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    expect(typeof result.current.handleColumnSizingChange).toBe("function");
  });

  it("provides setSizingStrategy function", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    expect(typeof result.current.setSizingStrategy).toBe("function");
  });

  it("provides applyAutoSizing function", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    expect(typeof result.current.applyAutoSizing).toBe("function");
  });

  it("provides resetColumnSizing function", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    expect(typeof result.current.clearColumnSizing).toBe("function");
  });

  it("calls setTableState when setSizingStrategy is called", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    act(() => {
      result.current.setSizingStrategy("fit-content");
    });

    expect(mockSetTableState).toHaveBeenCalled();
  });

  it("calls setTableState when resetColumnSizing is called", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    act(() => {
      result.current.clearColumnSizing();
    });

    expect(mockSetTableState).toHaveBeenCalled();
  });

  it("calls setTableState when applyAutoSizing is called", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    act(() => {
      result.current.applyAutoSizing();
    });

    expect(mockSetTableState).toHaveBeenCalled();
  });

  it("calls setTableState when handleColumnSizingChange is called", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    act(() => {
      result.current.handleColumnSizingChange({ col1: 120 });
    });

    expect(mockSetTableState).toHaveBeenCalled();
  });

  it("handles function updater in handleColumnSizingChange", () => {
    const { result } = renderHook(() =>
      useColumnSizing({
        columns: mockColumns,
        tableRef: mockTableRef,
        data: mockData,
      })
    );

    act(() => {
      result.current.handleColumnSizingChange((prev) => ({
        ...prev,
        col1: 120,
      }));
    });

    expect(mockSetTableState).toHaveBeenCalled();
  });
});
