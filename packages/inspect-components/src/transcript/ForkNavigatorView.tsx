import clsx from "clsx";
import { FC } from "react";

import type { SpanBeginEvent } from "@tsmono/inspect-common/types";

import styles from "./ForkNavigatorView.module.css";
import { TranscriptIcons } from "./icons";
import type { ForkNavData } from "./timeline/timelineEventNodes";
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
  if (!data || data.options.length < 2) return null;

  const { options, selectedIndex } = data;

  return (
    <div className={clsx(styles.nav, className)}>
      <i className={clsx(TranscriptIcons.fork, styles.icon)} />
      {options.map((opt, i) => (
        <button
          key={opt.rowKey}
          type="button"
          className={clsx(styles.pill, i === selectedIndex && styles.selected)}
          onClick={(e) =>
            i === selectedIndex
              ? undefined
              : selectRow?.(
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
    </div>
  );
};
