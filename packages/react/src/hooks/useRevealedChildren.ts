import { RefObject, useEffect, useState } from "react";

import { scrollContainer } from "./scrollingAncestor";

const kNone: ReadonlySet<number> = new Set();

/**
 * Indexes of the children of `containerRef` that have come within one
 * viewport height of its scroller's visible area. A child stays revealed once
 * it has been, so callers can swap in costly content that then remains.
 * `childrenKey` must change when the children do; it resets the set.
 */
export const useRevealedChildren = (
  containerRef: RefObject<HTMLElement | null>,
  childrenKey: unknown
): ReadonlySet<number> => {
  const [revealed, setRevealed] = useState<{
    key: unknown;
    indexes: ReadonlySet<number>;
  }>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const children = [...container.children];
    const observer = new IntersectionObserver(
      (entries) => {
        const newly = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => {
            observer.unobserve(entry.target);
            return children.indexOf(entry.target);
          });
        if (newly.length > 0) {
          setRevealed((prev) => ({
            key: childrenKey,
            indexes: new Set([
              ...(prev && prev.key === childrenKey ? prev.indexes : []),
              ...newly,
            ]),
          }));
        }
      },
      // The scroller as root, so the margin reaches past its visible area;
      // with the viewport as root, the scroller would clip everything outside.
      { root: scrollContainer(container), rootMargin: "100% 0px" }
    );
    for (const child of children) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [containerRef, childrenKey]);

  return revealed && revealed.key === childrenKey ? revealed.indexes : kNone;
};
