import { useLayoutEffect, useState, type RefObject } from "react";

import { rangeExceedsFold } from "../find/findClip";

import { useFindRow } from "./useFindHighlights";

/** `maxHeight: ${lines}rem` resolves against the root font size, not the
 *  panel's own. */
const rootFontSizePx = (): number =>
  parseFloat(getComputedStyle(document.documentElement).fontSize);

/**
 * Expand a collapsed panel only when the active Find occurrence sits below
 * its fold. Matching the typed letter anywhere in the subtree grew every
 * assistant message on the first keystroke.
 *
 * Inside a find row the row says where its active occurrence is (the panel
 * decides in its own layout effect and again after every row scan, so a
 * markdown render that moves the occurrence is followed). Panels outside a
 * find row still use a substring check so the legacy window.find path can
 * open a clipped hit.
 */
export function useExpandWhenFindBelowFold(
  contentRef: RefObject<HTMLElement | null>,
  lines: number,
  fallbackTerm: string | undefined
): boolean {
  const row = useFindRow();
  const [expand, setExpand] = useState(false);

  useLayoutEffect(() => {
    if (row) {
      const decide = () => {
        const root = contentRef.current;
        const range = row.activeRange();
        setExpand(
          root !== null &&
            range !== null &&
            root.contains(range.startContainer) &&
            rangeExceedsFold(root, range, lines * rootFontSizePx())
        );
      };
      decide();
      return row.subscribe(decide);
    }
    const scan = () => {
      const root = contentRef.current;
      if (!root || !fallbackTerm) {
        setExpand(false);
        return;
      }
      const text = root.textContent || "";
      setExpand(text.toLowerCase().includes(fallbackTerm.toLowerCase()));
    };
    scan();
    const root = contentRef.current;
    if (!root) return;
    const observer = new MutationObserver(scan);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-markdown-pending"],
    });
    return () => observer.disconnect();
  }, [row, lines, fallbackTerm, contentRef]);

  return expand;
}
