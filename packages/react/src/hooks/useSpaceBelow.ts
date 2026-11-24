import { RefObject, useEffect, useState } from "react";

/**
 * The height from an element's top to the bottom of its scroll container's
 * visible area, so the element can fill what's left on screen. Tracks
 * resizes of either element and of the container's direct children (a header
 * above the element collapsing moves it), window resizes, and container
 * scrolls (a sticky header may change size as the container scrolls).
 * Both refs must be attached when the effect first runs (they're read once
 * per ref identity, not polled); until then it returns 0.
 */
export const useSpaceBelow = (
  ref: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>
): number => {
  const [space, setSpace] = useState(0);

  useEffect(() => {
    const element = ref.current;
    const container = containerRef.current;
    if (!element || !container) return;
    const update = () => {
      const bottom = container.getBoundingClientRect().bottom;
      const top = element.getBoundingClientRect().top;
      setSpace(Math.max(0, Math.floor(bottom - top)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    window.addEventListener("resize", update);
    container.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      container.removeEventListener("scroll", update);
    };
  }, [ref, containerRef]);

  return space;
};
