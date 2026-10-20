// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useProgressiveTask, type ProgressiveTask } from "./useProgressiveTask";

// A task whose steps the test releases one at a time.
const steppedTask = (values: string[]) => {
  const gates: (() => void)[] = [];
  let aborted = false;
  const task: ProgressiveTask<string> = async (publish, signal) => {
    signal.addEventListener("abort", () => {
      aborted = true;
    });
    for (const value of values) {
      await new Promise<void>((resolve) => gates.push(resolve));
      publish(value);
    }
  };
  const step = async () => {
    await act(async () => {
      gates.shift()?.();
      await Promise.resolve();
    });
  };
  return { task, step, wasAborted: () => aborted };
};

describe("useProgressiveTask", () => {
  it("returns each value the task publishes", async () => {
    const { task, step } = steppedTask(["a", "b"]);
    const { result } = renderHook(() => useProgressiveTask(task));
    expect(result.current).toBeUndefined();
    await step();
    expect(result.current).toBe("a");
    await step();
    expect(result.current).toBe("b");
  });

  it("aborts the previous run and ignores its later publishes when the task changes", async () => {
    const first = steppedTask(["old-1", "old-2"]);
    const second = steppedTask(["new-1"]);
    const { result, rerender } = renderHook(
      ({ task }) => useProgressiveTask(task),
      { initialProps: { task: first.task } }
    );
    await first.step();
    expect(result.current).toBe("old-1");

    rerender({ task: second.task });
    expect(first.wasAborted()).toBe(true);
    expect(result.current).toBeUndefined();

    await first.step();
    expect(result.current).toBeUndefined();
    await second.step();
    expect(result.current).toBe("new-1");
  });

  it("aborts the run on unmount", async () => {
    const { task, step, wasAborted } = steppedTask(["a"]);
    const { unmount } = renderHook(() => useProgressiveTask(task));
    unmount();
    expect(wasAborted()).toBe(true);
    await step();
  });
});
