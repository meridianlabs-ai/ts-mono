import { RefObject, useCallback, useEffect, useMemo } from "react";

import { createLogger, debounce } from "@tsmono/util";

import { useComponentStateHooks } from "../state/ComponentStateContext";

const log = createLogger("scrolling");

export function useStatefulScrollPosition<
  T extends HTMLElement = HTMLDivElement,
>(
  elementRef: RefObject<T | null>,
  elementKey: string,
  delay = 1000,
  scrollable = true
) {
  const { useGetScrollPosition, useSetScrollPosition } =
    useComponentStateHooks();

  const getScrollPosition = useGetScrollPosition();
  const setScrollPosition = useSetScrollPosition();

  // Create debounced scroll handler
  const handleScrollInner = useCallback(
    (e: Event) => {
      const target = e.target as HTMLElement;
      const position = target.scrollTop;
      log.debug(`Storing scroll position`, elementKey, position);
      setScrollPosition(elementKey, position);
    },
    [elementKey, setScrollPosition]
  );

  const handleScroll = useMemo(
    () => debounce(handleScrollInner, delay),
    [handleScrollInner, delay]
  );

  // Function to manually restore scroll position
  const restoreScrollPosition = useCallback(() => {
    const element = elementRef.current;
    const savedPosition = getScrollPosition(elementKey);

    if (element && savedPosition !== undefined) {
      requestAnimationFrame(() => {
        element.scrollTop = savedPosition;

        requestAnimationFrame(() => {
          if (element.scrollTop !== savedPosition) {
            element.scrollTop = savedPosition;
          }
        });
      });
    }
  }, [elementKey, getScrollPosition, elementRef]);

  // Set up scroll listener and restore position on mount
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !scrollable) {
      return;
    }
    log.debug(`Restore Scroll Hook`, elementKey);

    // Restore scroll position on mount
    const savedPosition = getScrollPosition(elementKey);
    if (savedPosition !== undefined) {
      log.debug(`Restoring scroll position`, savedPosition);

      const tryRestoreScroll = () => {
        if (element.scrollHeight > element.clientHeight) {
          if (element.scrollTop !== savedPosition) {
            element.scrollTop = savedPosition;
            log.debug(`Scroll position restored to ${savedPosition}`);
          }
          return true;
        }
        return false;
      };

      if (!tryRestoreScroll()) {
        let attempts = 0;
        const maxAttempts = 5;

        const pollForRender = () => {
          if (tryRestoreScroll() || attempts >= maxAttempts) {
            if (attempts >= maxAttempts) {
              log.debug(
                `Failed to restore scroll after ${maxAttempts} attempts`
              );
            }
            return;
          }

          attempts++;
          setTimeout(pollForRender, 1000);
        };

        setTimeout(pollForRender, 1000);
      }
    }

    if (element.addEventListener) {
      element.addEventListener("scroll", handleScroll);
    } else {
      log.warn("Element has no way to add event listener", element);
    }

    return () => {
      if (element.removeEventListener) {
        element.removeEventListener("scroll", handleScroll);
      } else {
        log.warn("Element has no way to remove event listener", element);
      }
    };
  }, [elementKey, elementRef, getScrollPosition, handleScroll, scrollable]);

  return { restoreScrollPosition };
}
