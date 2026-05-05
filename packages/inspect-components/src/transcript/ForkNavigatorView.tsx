import clsx from "clsx";
import { FC } from "react";

import type { SpanBeginEvent } from "@tsmono/inspect-common/types";

import styles from "./ForkNavigatorView.module.css";
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
  const n = options.length;
  const go = (delta: number, el: HTMLElement) => {
    const next = (selectedIndex + delta + n) % n;
    selectRow?.(
      options[next]!.rowKey,
      el.closest<HTMLElement>("[data-index]") ?? el
    );
  };

  return (
    <div className={clsx(styles.nav, className)}>
      <button
        type="button"
        className={styles.btn}
        onClick={(e) => go(-1, e.currentTarget)}
        aria-label="Previous continuation"
      >
        <i className="bi bi-chevron-left" />
      </button>
      <span className={styles.count}>
        {selectedIndex + 1}/{n}
      </span>
      <button
        type="button"
        className={styles.btn}
        onClick={(e) => go(1, e.currentTarget)}
        aria-label="Next continuation"
      >
        <i className="bi bi-chevron-right" />
      </button>
      <span className={styles.label}>{options[selectedIndex]!.label}</span>
    </div>
  );
};
