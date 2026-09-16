import clsx from "clsx";
import { FC, Fragment, MouseEvent as ReactMouseEvent, RefObject } from "react";

import { VirtualList } from "@tsmono/react/virtual";

import { fmtDayClock } from "../usage";

import {
  ActivityCategory,
  ActivityHistoryRow,
  kActivityCategories,
  kCategoryLong,
  rowHaystack,
  rowKind,
} from "./activityData";
import styles from "./ActivityHistoryList.module.css";

const kPillClass: Record<ActivityCategory, string> = {
  error: styles.pillError,
  limit: styles.pillLimit,
  approval: styles.pillApproval,
  input: styles.pillInput,
  interrupt: styles.pillInterrupt,
  compaction: styles.pillCompaction,
  score: styles.pillScore,
};

/** Hover-link wash carries the category hue in its inset bar. */
const kWashClass: Record<ActivityCategory, string> = {
  error: styles.washError,
  limit: styles.washLimit,
  approval: styles.washApproval,
  input: styles.washInput,
  interrupt: styles.washInterrupt,
  compaction: styles.washCompaction,
  score: styles.washScore,
};

export interface ActivityHistoryListProps {
  rows: ActivityHistoryRow[];
  /** The tab's scroll container — rows virtualize against it. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Store-persisted VirtualList snapshot key, scoped per sample. */
  persistenceKey: string;
  /** Empty set = All; selection narrows additively. */
  selectedCategories: Set<ActivityCategory>;
  onToggleCategory: (category: ActivityCategory | "all") => void;
  search: string;
  onSearchChange: (search: string) => void;
  timeDescending: boolean;
  onToggleTimeSort: () => void;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
  /** Rows washed while their glyph is hovered on the rail. */
  washKeys: string[];
  onHoverRow: (key: string | null) => void;
  /** Click-through to the Transcript via event uuid. */
  onOpenEvent?: (uuid: string, event: ReactMouseEvent) => void;
  /** Dense-band bin click narrows the list to this window (clear chip). */
}

export const ActivityHistoryList: FC<ActivityHistoryListProps> = ({
  rows,
  scrollRef,
  persistenceKey,
  selectedCategories,
  onToggleCategory,
  search,
  onSearchChange,
  timeDescending,
  onToggleTimeSort,
  selectedKey,
  onSelectKey,
  washKeys,
  onHoverRow,
  onOpenEvent,
}) => {
  const counts = new Map<ActivityCategory, number>();
  for (const row of rows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }

  const query = search.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      (selectedCategories.size === 0 || selectedCategories.has(row.category)) &&
      (query === "" || rowHaystack(row).toLowerCase().includes(query))
  );
  const ordered = timeDescending ? [...visible].reverse() : visible;

  const renderRow = (index: number, row: ActivityHistoryRow) => {
    const selected = selectedKey === row.key;
    const washed = !selected && washKeys.includes(row.key);
    return (
      <div
        className={clsx(
          styles.row,
          index === ordered.length - 1 && styles.rowLast,
          selected && styles.rowSelected,
          washed && styles.rowWash,
          washed && kWashClass[row.category]
        )}
        role="button"
        tabIndex={0}
        onClick={() => onSelectKey(selected ? null : row.key)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectKey(selected ? null : row.key);
          }
        }}
        onMouseEnter={() => onHoverRow(row.key)}
        onMouseLeave={() => onHoverRow(null)}
      >
        <div className={styles.time}>{fmtDayClock(row.time)}</div>
        <div className={styles.kindCell}>
          <span className={clsx(styles.kindPill, kPillClass[row.category])}>
            {rowKind(row)}
          </span>
        </div>
        <div className={styles.event}>
          {row.lead}
          {row.mono !== undefined && (
            <Fragment>
              {" "}
              <span className={styles.mono}>{row.mono}</span>
            </Fragment>
          )}
          {row.tail !== undefined && ` ${row.tail}`}
          {row.detail !== undefined && (
            <span className={styles.muted}> · {row.detail}</span>
          )}
          {row.uuid !== undefined && onOpenEvent && (
            <Fragment>
              {" "}
              <button
                type="button"
                className={styles.openEvent}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenEvent(row.uuid!, event);
                }}
              >
                open in transcript →
              </button>
            </Fragment>
          )}
        </div>
        <div className={styles.by}>
          {row.by}
          {row.byRole !== undefined && (
            <span className={styles.muted}> {row.byRole}</span>
          )}
        </div>
      </div>
    );
  };

  const allSelected = selectedCategories.size === 0;
  const sortIcon = timeDescending ? "bi-arrow-down" : "bi-arrow-up";

  return (
    <div className={styles.container}>
      <div className={styles.filterRow}>
        <span className={styles.caption}>History</span>
        <button
          type="button"
          className={clsx(
            styles.filterPill,
            styles.pillAll,
            allSelected && styles.pillSelected
          )}
          onClick={() => onToggleCategory("all")}
        >
          All <span className={styles.pillCount}>{rows.length}</span>
        </button>
        {kActivityCategories.map((category) => {
          const count = counts.get(category) ?? 0;
          const selected = selectedCategories.has(category);
          return (
            <button
              key={category}
              type="button"
              className={clsx(
                styles.filterPill,
                kPillClass[category],
                selected && styles.pillSelected,
                count === 0 && styles.pillEmpty
              )}
              onClick={() => onToggleCategory(category)}
              // A selected pill stays clickable at count 0 (live counts can
              // drop) — otherwise the filter would trap an empty list.
              disabled={count === 0 && !selected}
            >
              {kCategoryLong[category]}{" "}
              <span className={styles.pillCount}>{count}</span>
            </button>
          );
        })}
        <input
          type="text"
          className={styles.search}
          placeholder="filter by event or detail"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className={styles.list}>
        <div className={styles.headerRow}>
          {/* Time is the one sortable column (task-timeline parity). */}
          <button
            type="button"
            className={styles.timeSort}
            onClick={onToggleTimeSort}
          >
            Time
            <i className={`bi ${sortIcon}`} aria-hidden="true" />
          </button>
          <span>Kind</span>
          <span>Event</span>
          <span className={styles.byHeader}>By</span>
        </div>
        {ordered.length === 0 ? (
          <div className={styles.empty}>No events</div>
        ) : (
          <VirtualList<ActivityHistoryRow>
            persistenceKey={persistenceKey}
            scrollRef={scrollRef}
            embedded
            data={ordered}
            estimatedItemHeight={33}
            overscan={10}
            renderRow={renderRow}
          />
        )}
      </div>
    </div>
  );
};
