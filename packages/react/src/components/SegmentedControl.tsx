import clsx from "clsx";
import { FC, useCallback } from "react";

import { inAppHref, inAppLinkClick } from "./inAppLink";
import styles from "./SegmentedControl.module.css";

export interface Segment {
  id: string;
  label: string;
  icon?: string;
  selectedId?: string;
  disabled?: boolean;
  /** URL the segment navigates to. When set (and the segment is enabled) it
   *  renders as a link so cmd/ctrl/middle-click open that view in a new tab;
   *  `onSegmentChange` still handles plain clicks. Ignored inside VS Code. */
  href?: string;
}

export interface SegmentedControlProps {
  id?: string;
  segments: Segment[];
  selectedId: string;
  onSegmentChange: (segmentId: string, index: number) => void;
  /**
   * Render icon-only segments. The label still flows to `aria-label` /
   * `title` so screen readers and tooltips work, but the visible
   * `<span>` is suppressed and per-segment padding is tightened. Each
   * segment must supply an `icon` when this is on.
   */
  compact?: boolean;
}

export const SegmentedControl: FC<SegmentedControlProps> = ({
  id,
  segments,
  onSegmentChange,
  selectedId: selectedIdProp,
  compact = false,
}) => {
  const handleSegmentClick = useCallback(
    (segmentId: string, index: number) => {
      onSegmentChange(segmentId, index);
    },
    [onSegmentChange]
  );

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const selectedId = selectedIdProp ?? segments[0]?.id ?? "";

  return (
    <div id={id} className={clsx(styles.rootControl)}>
      {segments.map((segment, index) => {
        const selected = selectedId === segment.id;
        const className = clsx(
          styles.segment,
          selected && styles.selected,
          compact && styles.compact,
          segment.disabled && styles.disabled,
          "text-size-smallest",
          selected ? undefined : "text-style-secondary"
        );
        const content = (
          <>
            {segment.icon && <i className={segment.icon} />}
            {!compact && <span>{segment.label}</span>}
          </>
        );
        const href = segment.disabled ? undefined : inAppHref(segment.href);
        return href ? (
          <a
            key={segment.id}
            href={href}
            className={className}
            onClick={inAppLinkClick(() =>
              handleSegmentClick(segment.id, index)
            )}
            aria-current={selected ? "page" : undefined}
            aria-label={compact ? segment.label : undefined}
            title={compact ? segment.label : undefined}
          >
            {content}
          </a>
        ) : (
          <button
            type="button"
            key={segment.id}
            className={className}
            onClick={() => handleSegmentClick(segment.id, index)}
            disabled={segment.disabled}
            aria-pressed={selected}
            aria-label={compact ? segment.label : undefined}
            title={compact ? segment.label : undefined}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
};
