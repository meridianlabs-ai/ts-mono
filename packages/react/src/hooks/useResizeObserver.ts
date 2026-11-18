import { RefObject, useEffect, useRef } from "react";

// Custom hook to observe size changes. Observes `ref`'s element when given,
// for a caller that also needs the element; otherwise the returned ref's.
export const useResizeObserver = <T extends HTMLElement = HTMLDivElement>(
  callback: (entry: ResizeObserverEntry) => void,
  ref?: RefObject<T | null>
) => {
  const ownRef = useRef<T>(null);
  const elementRef = ref ?? ownRef;
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    observerRef.current = new ResizeObserver((entries) => {
      if (entries[0]) {
        callback(entries[0]);
      }
    });

    observerRef.current.observe(element);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [callback, elementRef]);

  return elementRef;
};
