// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTerminalClock, useTerminalClock } from "./terminalClock";

describe("useTerminalClock", () => {
  it("re-renders only when the selected value changes", () => {
    const clock = createTerminalClock(0.2);
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useTerminalClock(clock, Math.floor);
    });
    expect(result.current).toBe(0);
    const before = renders;
    act(() => clock.setState({ playback: 0.9 }));
    expect(result.current).toBe(0);
    expect(renders).toBe(before);
    act(() => clock.setState({ playback: 1.4 }));
    expect(result.current).toBe(1);
    expect(renders).toBe(before + 1);
  });
});
