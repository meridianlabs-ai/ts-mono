import clsx from "clsx";
import { FC } from "react";

import type { SpanBeginEvent } from "@tsmono/inspect-common/types";

import styles from "./ForkNavigatorView.module.css";
import { TranscriptIcons } from "./icons";
import type { ForkNavData, ForkNavGroup } from "./timeline/timelineEventNodes";
import { useTimelineRowSelect } from "./TimelineSelectContext";
import { EventNode } from "./types";

interface ForkNavigatorViewProps {
  eventNode: EventNode<SpanBeginEvent>;
  className?: string;
}

export const ForkNavigatorView: FC<ForkNavigatorViewProps> = ({
  eventNode,
  className,
}) => {
  const data = (eventNode.event.metadata as Record<string, unknown> | null)
    ?.fork_nav as ForkNavData | undefined;
  const selectRow = useTimelineRowSelect();
  if (!data || data.groups.length === 0) return null;

  // A group is renderable only if it offers more than the stay-on-segment
  // pseudo-option. The previous code applied the same `length < 2` filter
  // at the whole-nav level; we now apply it per group.
  const renderable = data.groups.filter((g) => g.options.length >= 2);
  if (renderable.length === 0) return null;

  return (
    <div className={clsx(styles.nav, className)}>
      <i className={clsx(TranscriptIcons.fork, styles.icon)} />
      {renderable.map((group, gi) => (
        <ForkNavGroupView
          key={`${group.anchorId}-${gi}`}
          group={group}
          showDivider={gi > 0}
          onSelect={(rowKey, el) => selectRow?.(rowKey, el)}
        />
      ))}
    </div>
  );
};

interface ForkNavGroupViewProps {
  group: ForkNavGroup;
  showDivider: boolean;
  onSelect: (rowKey: string, anchor: HTMLElement) => void;
}

const ForkNavGroupView: FC<ForkNavGroupViewProps> = ({
  group,
  showDivider,
  onSelect,
}) => {
  const { options, selectedIndex } = group;
  return (
    <>
      {showDivider ? (
        <span className={styles.divider} aria-hidden="true" />
      ) : null}
      {options.map((opt, i) => (
        <button
          key={opt.rowKey}
          type="button"
          className={clsx(styles.pill, i === selectedIndex && styles.selected)}
          onClick={(e) =>
            i === selectedIndex
              ? undefined
              : onSelect(
                  opt.rowKey,
                  e.currentTarget.closest<HTMLElement>("[data-index]") ??
                    e.currentTarget
                )
          }
          aria-current={i === selectedIndex ? "true" : undefined}
        >
          {opt.label}
        </button>
      ))}
    </>
  );
};
