import clsx from "clsx";
import { FC, useLayoutEffect, useRef, useState } from "react";

import { EditButton } from "./EditButton";
import editStyles from "./EditButton.module.css";
import { TagChip } from "./TagChip";
import styles from "./TagStrip.module.css";

interface TagStripProps {
  tags: string[];
  showEdit: boolean;
  onEdit: () => void;
  className?: string;
  /**
   * When true, the strip watches its own width and shows only the
   * chips that fit on at most two lines. Any tags that wouldn't fit
   * are represented by a "…" overflow pill placed before the Edit
   * pill; clicking it opens the edit dialog so the full list is
   * reachable. Opted into by surfaces where deep wrap is visually
   * destructive (the viewer header). TaskTab leaves this off so chips
   * wrap freely inside its card.
   *
   * Disabled automatically when `showEdit` is false — without an Edit
   * pill the overflow indicator has nothing to anchor to, so chips
   * just wrap normally.
   */
  collapseOnWrap?: boolean;
}

// Maximum rows of chips before we collapse the overflow into a "…"
// pill. Two rows tolerate the common case of long tags on moderate
// widths; three rows is when the header layout starts to feel out of
// control.
const MAX_ROWS = 2;

/**
 * One trim step: given the offsetTops of the row's flex children (the
 * first `chipCount` are tag chips, the rest pills), return the next
 * visible-chip count, or null when the row already fits in `maxRows`.
 *
 * Jumps straight to the number of chips measured inside the first
 * `maxRows` rows instead of shedding one chip per step: each step is a
 * nested setState/re-render inside a layout effect, and one-per-chip
 * trips React's 50-nested-update cap on large tag sets
 * (react.dev/errors/185). With the row's used width fixed, flex-wrap derives each
 * item's placement from its predecessors alone, so the measured chip
 * prefix is exact; the strictly decreasing per-chip fallback then
 * makes room for the pills (overflow + Edit) on the allowed rows.
 *
 * Exported for unit tests — jsdom has no layout, so the DOM
 * measurement around this can't be exercised there.
 */
export const nextVisibleCount = (
  tops: number[],
  chipCount: number,
  maxRows: number
): number | null => {
  const rows = new Set(tops);
  if (rows.size <= maxRows || chipCount === 0) return null;
  const allowed = new Set([...rows].sort((a, b) => a - b).slice(0, maxRows));
  let fit = 0;
  for (const top of tops.slice(0, chipCount)) {
    if (allowed.has(top)) fit++;
  }
  return Math.min(chipCount - 1, fit);
};

/**
 * Wrap-aware chip row: tag chips followed by the Edit pill as the
 * last item, so when chips wrap to additional lines the Edit pill
 * follows the last chip onto whichever line it lands on. Layout
 * context (alignment, margin, shrink) is supplied by the consumer via
 * `className`.
 *
 * With {@link TagStripProps.collapseOnWrap} on, the strip allows up to
 * {@link MAX_ROWS} rows of chips; if they would spill onto a third
 * row, it surfaces a "…" overflow pill (with a tooltip listing the
 * hidden tags) before the Edit pill. Sizing is measured via
 * ResizeObserver — when the row widens, the strip restarts from the
 * full set and re-trims, so growth actually surfaces more chips. The
 * same restart happens on tag-set changes (so saving in the edit
 * dialog re-runs the layout against the new tags).
 */
export const TagStrip: FC<TagStripProps> = ({
  tags,
  showEdit,
  onEdit,
  className,
  collapseOnWrap = false,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);
  // Track the tags array reference we last reset against so we don't
  // loop on unrelated re-renders. `selectedLogDetails.tags` is a
  // fresh array after every refresh, so reference equality is a
  // reliable change signal here.
  const [lastTags, setLastTags] = useState<string[]>(tags);
  // The overflow pill only makes sense when there's also an Edit pill
  // to anchor it. Without edit, we let chips wrap normally.
  const enableCollapse = collapseOnWrap && showEdit;

  // Whenever the tag set changes, restart from "all visible". This is
  // the render-adjust pattern: the update is scheduled before the trim
  // effect below runs, so trimming always measures against the full
  // set first.
  if (lastTags !== tags) {
    setLastTags(tags);
    if (visibleCount !== tags.length) {
      setVisibleCount(tags.length);
    }
  }

  // Convergent trim: while the row spans more than MAX_ROWS, drop to
  // the measured fit count (see nextVisibleCount). Each setState
  // triggers a re-render and the effect re-runs to remeasure, so the
  // loop converges in a handful of re-renders regardless of
  // `tags.length`.
  useLayoutEffect(() => {
    if (!enableCollapse || !rowRef.current) return;
    const el = rowRef.current;
    const kids = Array.from(el.children) as HTMLElement[];
    if (kids.length < 2) return;
    // Distinct offsetTop values across the row's flex items = number
    // of layout rows (flex-wrap: wrap puts each wrapped run on its
    // own top); nextVisibleCount derives rows from these tops.
    const next = nextVisibleCount(
      kids.map((k) => k.offsetTop),
      Math.min(visibleCount, tags.length),
      MAX_ROWS
    );
    if (next !== null) {
      // DOM measurement can only happen after layout, so this
      // measure-and-converge loop genuinely needs setState in a layout
      // effect; it terminates because visibleCount strictly decreases.
      setVisibleCount(next);
    }
  }, [enableCollapse, visibleCount, tags, showEdit]);

  // On any real width change, optimistically reset to the full set —
  // a wider row may now fit more chips than the previous trim
  // allowed. The trim effect above will re-converge after the reset.
  useLayoutEffect(() => {
    if (!enableCollapse || !rowRef.current) return;
    const el = rowRef.current;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (Math.abs(w - lastWidth) > 1) {
        lastWidth = w;
        setVisibleCount(tags.length);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enableCollapse, tags.length]);

  if (tags.length === 0 && !showEdit) return null;
  const effectiveCount = Math.min(visibleCount, tags.length);
  const hiddenTags = tags.slice(effectiveCount);
  return (
    <div ref={rowRef} className={clsx(styles.tagRow, className)}>
      {tags.slice(0, effectiveCount).map((tag) => (
        <TagChip
          key={tag}
          label={tag}
          onClick={showEdit ? onEdit : undefined}
        />
      ))}
      {hiddenTags.length > 0 && (
        <OverflowPill hiddenTags={hiddenTags} onClick={onEdit} />
      )}
      {showEdit && (
        <EditButton onClick={onEdit} title="Edit tags" variant="pill">
          {/* The pill labels itself only when no chips are present to
              indicate purpose. Once any tag (visible or hidden behind
              the overflow pill) exists, the action becomes "Edit". */}
          {tags.length === 0 ? "Tags" : "edit"}
        </EditButton>
      )}
    </div>
  );
};

/**
 * Outline pill rendered in place of overflowed chips. Matches the
 * Edit pill's visual via composed EditButton styles; the tooltip
 * reveals the hidden tag names. Clicking opens the same edit dialog
 * the Edit pill does, so the full list is one click away.
 */
const OverflowPill: FC<{
  hiddenTags: string[];
  onClick: () => void;
}> = ({ hiddenTags, onClick }) => {
  const count = hiddenTags.length;
  const title = `${count} more tag${count === 1 ? "" : "s"}: ${hiddenTags.join(", ")}`;
  return (
    <button
      type="button"
      className={clsx(editStyles.button, editStyles.pill, "text-size-smaller")}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      …
    </button>
  );
};
