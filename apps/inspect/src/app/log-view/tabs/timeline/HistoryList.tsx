import clsx from "clsx";
import {
  FC,
  Fragment,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useEffect,
  useRef,
} from "react";

import { ConfigUpdate, LogUpdate } from "@tsmono/inspect-common/types";
import {
  ConnectionReasonBadge,
  LimitTransition,
} from "@tsmono/inspect-components/usage";

import styles from "./HistoryList.module.css";
import {
  formatShort,
  HistoryCategory,
  HistoryRow,
  markerKey,
  rowCategory,
} from "./timelineData";

// Tag/metadata edits can land days after the run — always show the date.
const fmtRowTime = (sec: number): string => {
  const date = new Date(sec * 1000);
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${day} ${date.toLocaleTimeString(undefined, { hour12: false })}`;
};

interface CategoryChipProps {
  icon: string;
  label: string;
  kind: "config" | "tags" | "runtime" | "connections";
  selected?: boolean;
}

const CategoryChip: FC<CategoryChipProps> = ({
  icon,
  label,
  kind,
  selected,
}) => (
  <span
    className={clsx(
      styles.categoryChip,
      kind === "config" && styles.chipConfig,
      kind === "tags" && styles.chipTags,
      kind === "runtime" && styles.chipRuntime,
      kind === "connections" && styles.chipConnections,
      selected && styles.chipOnTint
    )}
  >
    <i className={`bi ${icon}`} aria-hidden="true" />
    {label}
  </span>
);

const PostRunChip: FC = () => (
  <span className={styles.postRunChip}>post-run</span>
);

const ScopePill: FC<{ update: ConfigUpdate }> = ({ update }) => {
  const inherited = update.provenance.metadata?.["inherited"] === true;
  return (
    <span className={styles.scopePill}>
      {update.scope}
      {inherited ? " · inherited" : ""}
    </span>
  );
};

const ConfigChangeLines: FC<{ update: ConfigUpdate }> = ({ update }) => (
  <div className={styles.changeLines}>
    {update.changes.map((change, i) => (
      <div key={i} className={styles.changeLine}>
        {change.config === "concurrency" ? (
          <Fragment>
            {change.name}{" "}
            <span className={styles.muted}>
              {formatShort(change.previous)} →{" "}
            </span>
            <b>{formatShort(change.value)}</b>{" "}
            <span className={styles.auditOnlyChip}>
              audit-only — not folded into config
            </span>
          </Fragment>
        ) : change.cleared ? (
          <Fragment>
            <span className={styles.muted}>{change.config}.</span>
            {change.name}{" "}
            <span className={styles.muted}>
              override cleared → launch value
            </span>
          </Fragment>
        ) : (
          <Fragment>
            <span className={styles.muted}>{change.config}.</span>
            {change.name}{" "}
            <span className={styles.muted}>
              {formatShort(change.previous)} →{" "}
            </span>
            <b>{change.value === null ? "null" : formatShort(change.value)}</b>
            {change.value === null && change.previous !== null ? (
              <span className={styles.muted}> (limit lifted)</span>
            ) : null}
          </Fragment>
        )}
      </div>
    ))}
  </div>
);

const LogUpdateLines: FC<{ update: LogUpdate }> = ({ update }) => (
  <div className={styles.changeLines}>
    {update.edits.map((edit, i) => {
      if (edit.type === "tags") {
        const parts = [
          ...edit.tags_add.map((t) => `+${t}`),
          ...edit.tags_remove.map((t) => `−${t}`),
        ];
        return (
          <div key={i} className={styles.changeLine}>
            {parts.join("  ")}
          </div>
        );
      }
      const metadataEdit = edit;
      return (
        <Fragment key={i}>
          {Object.entries(metadataEdit.metadata_set).map(([key, value]) => (
            <div key={`set-${key}`} className={styles.changeLine}>
              {key} <span className={styles.muted}>∅ → </span>
              <b>{JSON.stringify(value)}</b>
            </div>
          ))}
          {metadataEdit.metadata_remove.map((key) => (
            <div key={`rm-${key}`} className={styles.changeLine}>
              {key} <span className={styles.muted}>removed</span>
            </div>
          ))}
        </Fragment>
      );
    })}
  </div>
);

const logUpdateChip = (update: LogUpdate): { icon: string; label: string } =>
  update.edits.some((edit) => edit.type === "metadata")
    ? { icon: "bi-table", label: "Metadata" }
    : { icon: "bi-tags", label: "Tags" };

// The chart-linkable rows: config ◆ and tag/metadata ◆ share the rail.
const rowKey = (row: HistoryRow): string | undefined =>
  row.kind === "config"
    ? markerKey("config", row.index)
    : row.kind === "logUpdate"
      ? markerKey("log", row.index)
      : undefined;

export interface HistoryListProps {
  rows: HistoryRow[];
  enabledCategories: Set<HistoryCategory>;
  onToggleCategory: (category: HistoryCategory | "all") => void;
  selectedEventKey: string | null;
  onSelectEvent: (key: string | null) => void;
  onOpenSample?: (
    id: string | number,
    epoch: number,
    event: ReactMouseEvent
  ) => void;
}

export const HistoryList: FC<HistoryListProps> = ({
  rows,
  enabledCategories,
  onToggleCategory,
  selectedEventKey,
  onSelectEvent,
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
  const visible = rows.filter((row) => enabledCategories.has(rowCategory(row)));

  const filters: { id: HistoryCategory; label: string }[] = [
    { id: "config", label: "Config" },
    { id: "tags", label: "Tags & metadata" },
    { id: "runtime", label: "Runtime" },
    { id: "connections", label: "Connections" },
  ];

  const allOn = filters.every(
    (f) => (counts.get(f.id) ?? 0) === 0 || enabledCategories.has(f.id)
  );

  const rowBody = (row: HistoryRow): { chip: ReactNode; detail: ReactNode } => {
    switch (row.kind) {
      case "config":
        return {
          chip: (
            <CategoryChip
              icon="bi-sliders"
              label="Config"
              kind="config"
              selected={selectedEventKey === rowKey(row)}
            />
          ),
          detail: (
            <div className={styles.detailStack}>
              <div className={styles.detailHead}>
                <span className={styles.author}>
                  {row.update.provenance.author}
                </span>
                <ScopePill update={row.update} />
                {row.update.provenance.reason ? (
                  <span className={styles.muted}>
                    {row.update.provenance.reason}
                  </span>
                ) : null}
                {row.postRun ? <PostRunChip /> : null}
              </div>
              <ConfigChangeLines update={row.update} />
            </div>
          ),
        };
      case "logUpdate": {
        const chip = logUpdateChip(row.update);
        return {
          chip: (
            <CategoryChip
              icon={chip.icon}
              label={chip.label}
              kind="tags"
              selected={selectedEventKey === rowKey(row)}
            />
          ),
          detail: (
            <div className={styles.detailStack}>
              <div className={styles.detailHead}>
                <span className={styles.author}>
                  {row.update.provenance.author}
                </span>
                {row.update.provenance.reason ? (
                  <span className={styles.muted}>
                    {row.update.provenance.reason}
                  </span>
                ) : null}
                {row.postRun ? <PostRunChip /> : null}
              </div>
              <LogUpdateLines update={row.update} />
            </div>
          ),
        };
      }
      case "runStart":
        return {
          chip: <CategoryChip icon="bi-play" label="Run" kind="runtime" />,
          detail: (
            <div className={styles.detailHead}>
              <span>Run started</span>
              <span className={styles.monoDetail}>{row.detail}</span>
            </div>
          ),
        };
      case "runEnd": {
        const label =
          row.status === "cancelled"
            ? "Run cancelled"
            : row.status === "error"
              ? "Run crashed"
              : "Run completed";
        return {
          chip: <CategoryChip icon="bi-check2" label="Run" kind="runtime" />,
          detail: (
            <div className={styles.detailHead}>
              <span>{label}</span>
              <span className={styles.monoDetail}>{row.detail}</span>
            </div>
          ),
        };
      }
      case "connections":
        return {
          chip: (
            <CategoryChip
              icon="bi-activity"
              label="Connections"
              kind="connections"
            />
          ),
          detail: (
            <div className={styles.detailHead}>
              <span>Connections</span>
              <span className={styles.monoDetail}>{row.model}</span>
              <LimitTransition oldLimit={row.from} newLimit={row.to} />
              <ConnectionReasonBadge reason={row.reason} count={row.count} />
            </div>
          ),
        };
      case "sampleError":
        return {
          chip: (
            <CategoryChip
              icon="bi-arrow-repeat"
              label="Runtime"
              kind="runtime"
            />
          ),
          detail: (
            <div className={styles.detailHead}>
              <span>
                Sample error
                {(row.sample.retries ?? 0) > 0 ? ", retried" : ""}
              </span>
              <span className={styles.monoDetail}>
                sample {row.sample.id} · {row.sample.error}
                {(row.sample.retries ?? 0) > 0
                  ? ` · ${row.sample.retries} retr${row.sample.retries === 1 ? "y" : "ies"}`
                  : ""}
              </span>
              {onOpenSample && (
                <button
                  type="button"
                  className={styles.openSample}
                  onClick={(event) =>
                    onOpenSample(row.sample.id, row.sample.epoch, event)
                  }
                >
                  open sample →
                </button>
              )}
            </div>
          ),
        };
      case "sampleLimit":
        return {
          chip: (
            <CategoryChip
              icon="bi-arrow-repeat"
              label="Runtime"
              kind="runtime"
            />
          ),
          detail: (
            <div className={styles.detailHead}>
              <span>Sample hit {row.sample.limit}</span>
              <span className={styles.monoDetail}>sample {row.sample.id}</span>
              {onOpenSample && (
                <button
                  type="button"
                  className={styles.openSample}
                  onClick={(event) =>
                    onOpenSample(row.sample.id, row.sample.epoch, event)
                  }
                >
                  open sample →
                </button>
              )}
            </div>
          ),
        };
      case "fallback":
        return {
          chip: (
            <CategoryChip
              icon="bi-arrow-repeat"
              label="Runtime"
              kind="runtime"
            />
          ),
          detail: (
            <div className={styles.detailHead}>
              <span>Model fallback</span>
              <span className={styles.monoDetail}>
                {row.line} (sample {row.sample.id})
              </span>
            </div>
          ),
        };
      case "earlyStopping":
        return {
          chip: (
            <CategoryChip
              icon="bi-arrow-repeat"
              label="Runtime"
              kind="runtime"
            />
          ),
          detail: (
            <div className={styles.detailHead}>
              <span>Early stopping</span>
              <span className={styles.monoDetail}>
                {row.summary.manager} · {row.summary.early_stops.length} skipped
              </span>
            </div>
          ),
        };
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.filterRow}>
        <span className={styles.caption}>History</span>
        <button
          type="button"
          className={clsx(styles.filterChip, allOn && styles.filterChipActive)}
          onClick={() => onToggleCategory("all")}
        >
          All ({rows.length})
        </button>
        {filters.map((filter) => {
          const count = counts.get(filter.id) ?? 0;
          const enabled = enabledCategories.has(filter.id);
          return (
            <button
              key={filter.id}
              type="button"
              className={clsx(
                styles.filterChip,
                enabled && count > 0 && styles.filterChipActive,
                count === 0 && styles.filterChipEmpty
              )}
              onClick={() => onToggleCategory(filter.id)}
              disabled={count === 0}
            >
              {enabled && count > 0 ? (
                <i className="bi bi-check" aria-hidden="true" />
              ) : null}
              {filter.label} ({count})
            </button>
          );
        })}
      </div>
      <div className={styles.list}>
        {visible.length === 0 ? (
          <div className={styles.empty}>No events</div>
        ) : (
          visible.map((row, i) => {
            const { chip, detail } = rowBody(row);
            const key = rowKey(row);
            const selected = key !== undefined && selectedEventKey === key;
            return (
              <div
                key={i}
                ref={selected ? selectedRef : undefined}
                className={clsx(
                  styles.row,
                  selected && styles.rowSelected,
                  key !== undefined && styles.rowClickable
                )}
                onClick={
                  key !== undefined
                    ? () => onSelectEvent(selected ? null : key)
                    : undefined
                }
              >
                <div className={styles.time}>{fmtRowTime(row.time)}</div>
                <div className={styles.chipCell}>{chip}</div>
                <div className={styles.detail}>{detail}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
