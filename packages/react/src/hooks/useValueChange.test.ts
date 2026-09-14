// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useValueChange } from "./useValueChange";

it("notifies on mount and changes, using the latest callback without notification loops", () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ value, notify }) => useValueChange(value, notify),
    { initialProps: { value: 1, notify: first } }
  );
  expect(first).toHaveBeenCalledExactlyOnceWith(1);
  rerender({ value: 1, notify: second });
  expect(second).not.toHaveBeenCalled();
  rerender({ value: 2, notify: second });
  expect(second).toHaveBeenCalledExactlyOnceWith(2);
  unmount();
  expect(second).toHaveBeenCalledTimes(1);
});
