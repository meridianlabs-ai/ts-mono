import { RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { StateCallback, StateSnapshot, VirtuosoHandle } from "react-virtuoso";

import { createLogger, debounce } from "@tsmono/util";

import { useComponentStateHooks } from "../state/ComponentStateContext";

const log = createLogger("scrolling");

type DebouncedFunction<T extends (...args: never[]) => unknown> = T & {
  cancel: () => void;
  flush: () => void;
};

export const useVirtuosoState = (
  virtuosoRef: RefObject<VirtuosoHandle | null>,
  elementKey: string,
  delay = 1000
) => {
  const {
    useListPosition,
    useSetListPosition,
    useClearListPosition,
    useVisibleRanges,
    useSetVisibleRange,
  } = useComponentStateHooks();

  const restoreState = useListPosition(elementKey);

  const setListPosition = useSetListPosition();
  const clearListPosition = useClearListPosition();

  const debouncedFnRef = useRef<DebouncedFunction<
    (isScrolling: boolean) => void
  > | null>(null);

  const handleStateChange: StateCallback = useCallback(
    (state: StateSnapshot) => {
      log.debug(`Storing list state: [${elementKey}]`, state);
      setListPosition(elementKey, state);
    },
    [elementKey, setListPosition]
  );

  useEffect(() => {
    debouncedFnRef.current = debounce((isScrolling: boolean) => {
      log.debug("List scroll", isScrolling);
      const element = virtuosoRef.current;
      if (!element) {
        return;
      }
      element.getState(handleStateChange);
    }, delay) as DebouncedFunction<(isScrolling: boolean) => void>;

    return () => {
      clearListPosition(elementKey);
    };
  }, [delay, elementKey, handleStateChange, clearListPosition, virtuosoRef]);

  const isScrolling = useCallback((scrolling: boolean) => {
    if (!scrolling) {
      return;
    }

    if (debouncedFnRef.current) {
      debouncedFnRef.current(scrolling);
    }
  }, []);

  // Use a ref to prevent re-rendering just because the restore state changes
  const stateRef = useRef(restoreState);
  useEffect(() => {
    stateRef.current = restoreState;
  }, [restoreState]);

  const getRestoreState = useCallback(() => stateRef.current, []);

  const setVisibleRangeRaw = useSetVisibleRange();

  const setVisibleRange = useCallback(
    (value: { startIndex: number; endIndex: number }) => {
      setVisibleRangeRaw(elementKey, value);
    },
    [setVisibleRangeRaw, elementKey]
  );

  const visibleRanges = useVisibleRanges();
  const visibleRange = useMemo(() => {
    return (
      visibleRanges[elementKey] || {
        startIndex: 0,
        endIndex: 0,
      }
    );
  }, [visibleRanges, elementKey]);

  return { getRestoreState, isScrolling, visibleRange, setVisibleRange };
};
