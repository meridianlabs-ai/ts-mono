// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { UseColumnFilterParams } from "./useColumnFilter";
import { useColumnFilter } from "./useColumnFilter";

const defaultParams: UseColumnFilterParams = {
  columnId: "task",
  filterType: "string",
  spec: null,
  isOpen: true,
};

describe("useColumnFilter buildSpec", () => {
  it("returns a spec for a valid input", () => {
    const { result } = renderHook(() => useColumnFilter(defaultParams));
    act(() => {
      result.current.setOperator("contains");
      result.current.setValue("petri");
    });
    expect(result.current.buildSpec()).toEqual({
      operator: "contains",
      value: "petri",
      value2: undefined,
    });
  });

  it("returns null for an empty value", () => {
    const { result } = renderHook(() => useColumnFilter(defaultParams));
    act(() => {
      result.current.setOperator("contains");
      result.current.setValue("");
    });
    expect(result.current.buildSpec()).toBeNull();
  });

  it("returns null for a separators-only list value", () => {
    const { result } = renderHook(() => useColumnFilter(defaultParams));
    act(() => {
      result.current.setOperator("in");
      result.current.setValue(",,");
    });
    expect(result.current.buildSpec()).toBeNull();
  });

  it("returns undefined for unparseable input", () => {
    const { result } = renderHook(() =>
      useColumnFilter({
        ...defaultParams,
        columnId: "score",
        filterType: "number",
      })
    );
    act(() => {
      result.current.setOperator("=");
      result.current.setValue("abc");
    });
    expect(result.current.buildSpec()).toBeUndefined();
  });

  it("returns a takesNoValue spec for 'is blank' regardless of value text", () => {
    const { result } = renderHook(() => useColumnFilter(defaultParams));
    act(() => {
      result.current.setOperator("is blank");
      result.current.setValue("leftover text");
    });
    expect(result.current.takesNoValue).toBe(true);
    expect(result.current.buildSpec()).toEqual({
      operator: "is blank",
      value: "",
    });
  });
});

describe("useColumnFilter editor sync", () => {
  it("discards edits when closed without committing", () => {
    const { result, rerender } = renderHook(
      (props: UseColumnFilterParams) => useColumnFilter(props),
      { initialProps: { ...defaultParams, isOpen: true } }
    );
    act(() => {
      result.current.setValue("x");
    });
    expect(result.current.value).toBe("x");

    rerender({ ...defaultParams, isOpen: false });
    rerender({ ...defaultParams, isOpen: true });
    expect(result.current.value).toBe("");
  });
});
