import { useEffect, useState } from "react";

/**
 * A task that publishes partial results as it works. `signal` aborts when the
 * task is replaced or its component unmounts.
 */
export type ProgressiveTask<T> = (
  publish: (value: T) => void,
  signal: AbortSignal
) => Promise<void>;

/**
 * Runs `task` and returns the last value it published, or undefined before
 * its first publish. A new `task` identity starts a new run: the previous
 * run's signal aborts and anything it publishes afterwards is ignored. Wrap
 * `task` in `useCallback` with its inputs as deps; its identity decides when
 * work restarts. Errors from a run that is still current are logged.
 */
export const useProgressiveTask = <T>(
  task: ProgressiveTask<T>
): T | undefined => {
  const [state, setState] = useState<{
    task: ProgressiveTask<T>;
    value: T;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    const publish = (value: T) => {
      if (!controller.signal.aborted) {
        setState({ task, value });
      }
    };
    task(publish, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error(error);
      }
    });
    return () => controller.abort();
  }, [task]);

  return state?.task === task ? state.value : undefined;
};
