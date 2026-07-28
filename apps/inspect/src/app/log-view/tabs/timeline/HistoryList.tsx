import clsx from "clsx";
import {
  FC,
  Fragment,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useEffect,
  useRef,
} from "react";

import {
  fmtDayClock,
  kConnectionReasonLabel,
} from "@tsmono/inspect-components/usage";

import styles from "./HistoryList.module.css";
import {
  formatShort,
  HistoryCategory,
  HistoryRow,
  kCategoryLong,
  kCategoryShort,
  kHistoryCategories,
  markerKey,
  rowCategory,
  rowHaystack,
} from "./timelineData";

const kPillClass: Record<HistoryCategory, string> = {
  config: styles.pillConfig!,
  connections: styles.pillConnections!,
  limits: styles.pillLimits!,
  errors: styles.pillErrors!,
  cancels: styles.pillCancels!,
  tags: styles.pillTags!,
  run: styles.pillRun!,
};

// The chart-linkable rows: config ◆ and tag/metadata ◆ share the rail.
const rowKey = (row: HistoryRow): string | undefined =>
  row.kind === "config"
    ? markerKey("config", row.index)
    : row.kind === "logUpdate"
      ? markerKey("log", row.index)
      : undefined;

// Local part only — the full address lives in the cell's title.
const byInfo = (row: HistoryRow): { text: string; title?: string } => {
  switch (row.kind) {
    case "config":
    case "logUpdate": {
      const author = row.update.provenance.author;
      return { text: author.split("@")[0] || author, title: author };
    }
    case "runStart":
    case "runEnd":
      return { text: "—" };
    default:
      return { text: "system" };
  }
};

export interface HistoryListProps {
  rows: HistoryRow[];
  /** Config-marker ordinals keyed by markerKey — the shared rail token. */
  ordinals: Map<string, number>;
  /** Empty set = All; selection narrows additively (canvas 37a). */
  selectedCategories: Set<HistoryCategory>;
  onToggleCategory: (category: HistoryCategory | "all") => void;
  search: string;
  onSearchChange: (search: string) => void;
  timeDescending: boolean;
  onToggleTimeSort: () => void;
  selectedEventKey: string | null;
  onSelectEvent: (key: string | null) => void;
  /** Rows washed lavender while their marker is hovered on the rail. */
  washKeys: string[];
  onHoverRow: (key: string | null) => void;
  onOpenSample?: (
    id: string | number,
    epoch: number,
    event: ReactMouseEvent
  ) => void;
}

export const HistoryList: FC<HistoryListProps> = ({
  rows,
  ordinals,
  selectedCategories,
  onToggleCategory,
  search,
  onSearchChange,
  timeDescending,
  onToggleTimeSort,
  selectedEventKey,
  onSelectEvent,
  washKeys,
  onHoverRow,
  onOpenSample,
}) => {
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedEventKey !== null) {
      selectedRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedEventKey]);

  const counts = new Map<HistoryCategory, number>();
  for (const row of rows) {
    const category = rowCategory(row);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const query = search.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      (selectedCategories.size === 0 ||
        selectedCategories.has(rowCategory(row))) &&
      (query === "" || rowHaystack(row).toLowerCase().includes(query))
  );
  const ordered = timeDescending ? [...visible].reverse() : visible;

  const openLink = (sample: {
    id: string | number;
    epoch: number;
  }): ReactNode =>
    onOpenSample ? (
      <button
        type="button"
        className={styles.openSample}
        onClick={(event) => {
          event.stopPropagation();
          onOpenSample(sample.id, sample.epoch, event);
        }}
      >
        open →
      </button>
    ) : null;

  // One sentence per row: body colour for the event itself, muted for
  // everything parenthetical, mono (never bold) separating values from
  // prose (canvas 37a).
  const eventCell = (row: HistoryRow): ReactNode => {
    switch (row.kind) {
      case "config": {
        const ordinal = ordinals.get(markerKey("config", row.index));
        const inherited =
          row.update.provenance.metadata?.["inherited"] === true;
        return (
          <Fragment>
            {ordinal !== undefined && (
              <span className={styles.ordinalBox}>{ordinal}</span>
            )}
            {row.update.changes.map((change, i) => (
              <Fragment key={i}>
                {i > 0 && <span className={styles.muted}>{" · "}</span>}
                <span className={styles.mono}>
                  {change.config}.{change.name}
                </span>{" "}
                {change.cleared ? (
                  <span className={styles.muted}>
                    override cleared → launch value
                  </span>
                ) : (
                  <Fragment>
                    <span className={clsx(styles.mono, styles.muted)}>
                      {formatShort(change.previous)} →{" "}
                    </span>
                    <span className={styles.mono}>
                      {formatShort(change.value)}
                    </span>
                    {/* A knob first set to null is a plain transition —
                        matching limitLifted and changeText. */}
                    {change.value === null &&
                    change.previous !== null &&
                    change.previous !== undefined ? (
                      <span className={styles.muted}> (limit lifted)</span>
                    ) : null}
                  </Fragment>
                )}
                {change.config === "concurrency" && (
                  <span className={styles.muted}>
                    {" · audit-only, not folded"}
                  </span>
                )}
              </Fragment>
            ))}
            <span className={styles.muted}>
              {" · "}
              {row.update.scope} scope
              {inherited ? " · inherited" : ""}
            </span>
            {row.update.provenance.reason ? (
              <span className={styles.muted}>
                {" · “"}
                {row.update.provenance.reason}
                {"”"}
              </span>
            ) : null}
            {row.postRun && <span className={styles.muted}> · post-run</span>}
          </Fragment>
        );
      }
      case "logUpdate": {
        const parts: ReactNode[] = [];
        row.update.edits.forEach((edit, i) => {
          if (edit.type === "tags") {
            const tags = [
              ...edit.tags_add.map((tag) => `+${tag}`),
              ...edit.tags_remove.map((tag) => `−${tag}`),
            ];
            if (tags.length > 0) {
              parts.push(
                <span key={`tags-${i}`} className={styles.mono}>
                  {tags.join("  ")}
                </span>
              );
            }
          } else {
            // "set", not "∅ →" — metadata_set can overwrite an existing key
            // (the schema carries no previous value).
            for (const [key, value] of Object.entries(edit.metadata_set)) {
              parts.push(
                <Fragment key={`set-${i}-${key}`}>
                  <span className={styles.mono}>{key}</span>
                  <span className={styles.muted}> set to </span>
                  <span className={styles.mono}>{JSON.stringify(value)}</span>
                </Fragment>
              );
            }
            for (const key of edit.metadata_remove) {
              parts.push(
                <Fragment key={`rm-${i}-${key}`}>
                  <span className={styles.mono}>{key}</span>
                  <span className={styles.muted}> removed</span>
                </Fragment>
              );
            }
          }
        });
        return (
          <Fragment>
            {parts.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && <span className={styles.muted}>{" · "}</span>}
                {part}
              </Fragment>
            ))}
            {row.update.provenance.reason ? (
              <span className={styles.muted}>
                {" · “"}
                {row.update.provenance.reason}
                {"”"}
              </span>
            ) : null}
            {row.postRun && <span className={styles.muted}> · post-run</span>}
          </Fragment>
        );
      }
      case "connections":
        return (
          <Fragment>
            {row.to >= row.from ? "Pool raised" : "Pool cut"}{" "}
            <span className={styles.mono}>{row.model}</span>{" "}
            <span className={clsx(styles.mono, styles.muted)}>
              {row.from} →{" "}
            </span>
            <span className={styles.mono}>{row.to}</span>
            <span className={styles.muted}>
              {" · "}
              {kConnectionReasonLabel[row.reason]}
              {row.count > 1 ? `, ×${row.count}` : ""}
            </span>
          </Fragment>
        );
      case "sampleLimit":
        return (
          <Fragment>
            Sample <span className={styles.mono}>{row.sample.id}</span> hit{" "}
            {row.sample.limit} limit {openLink(row.sample)}
          </Fragment>
        );
      case "sampleError":
        return (
          <Fragment>
            Sample <span className={styles.mono}>{row.sample.id}</span> errored
            {(row.sample.retries ?? 0) > 0
              ? `, retried ×${row.sample.retries}`
              : ""}
            <span className={styles.muted}> · {row.sample.error}</span>{" "}
            {openLink(row.sample)}
          </Fragment>
        );
      // The exception text carries no information beyond "cancelled",
      // so leave it off.
      case "sampleCancelled":
        return (
          <Fragment>
            Sample <span className={styles.mono}>{row.sample.id}</span>{" "}
            cancelled
            {(row.sample.retries ?? 0) > 0
              ? `, retried ×${row.sample.retries}`
              : ""}{" "}
            {openLink(row.sample)}
          </Fragment>
        );
      case "fallback":
        return (
          <Fragment>
            Model fallback <span className={styles.mono}>{row.line}</span>
            <span className={styles.muted}> · sample {row.sample.id}</span>
          </Fragment>
        );
      case "runStart":
        return (
          <Fragment>
            Run started
            <span className={clsx(styles.mono, styles.muted)}>
              {" — "}
              {row.detail}
            </span>
          </Fragment>
        );
      case "runEnd": {
        const label =
          row.status === "cancelled"
            ? "Run cancelled"
            : row.status === "error"
              ? "Run failed"
              : "Run completed";
        return (
          <Fragment>
            {label}
            <span className={clsx(styles.mono, styles.muted)}>
              {" — "}
              {row.detail}
            </span>
          </Fragment>
        );
      }
      case "earlyStopping":
        return (
          <Fragment>
            Early stopping
            <span className={clsx(styles.mono, styles.muted)}>
              {" — "}
              {row.summary.manager} · {row.summary.early_stops.length} skipped
            </span>
          </Fragment>
        );
    }
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
        {kHistoryCategories.map((category) => {
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
          placeholder="filter by event or author"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className={styles.list}>
        <div className={styles.headerRow}>
          {/* The one sortable column — any other sort destroys the list's
              causal read (canvas 37b). */}
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
          ordered.map((row, i) => {
            const key = rowKey(row);
            const category = rowCategory(row);
            const selected = key !== undefined && selectedEventKey === key;
            const washed = key !== undefined && washKeys.includes(key);
            const by = byInfo(row);
            return (
              <div
                key={i}
                ref={selected ? selectedRef : undefined}
                className={clsx(
                  styles.row,
                  selected && styles.rowSelected,
                  !selected && washed && styles.rowWash,
                  key !== undefined && styles.rowClickable
                )}
                onClick={
                  key !== undefined
                    ? () => onSelectEvent(selected ? null : key)
                    : undefined
                }
                onMouseEnter={
                  key !== undefined ? () => onHoverRow(key) : undefined
                }
                onMouseLeave={
                  key !== undefined ? () => onHoverRow(null) : undefined
                }
              >
                {/* Tag/metadata edits can land days after the run — the
                    date always shows. */}
                <div className={styles.time}>{fmtDayClock(row.time)}</div>
                <div className={styles.kindCell}>
                  <span className={clsx(styles.kindPill, kPillClass[category])}>
                    {kCategoryShort[category]}
                  </span>
                </div>
                <div className={styles.event}>{eventCell(row)}</div>
                <div className={styles.by} title={by.title}>
                  {by.text}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
