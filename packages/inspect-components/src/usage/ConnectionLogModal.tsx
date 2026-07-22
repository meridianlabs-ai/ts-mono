import clsx from "clsx";
import { FC, useMemo, useState } from "react";

import type { ConnectionLimitChange } from "@tsmono/inspect-common/types";
import { Modal } from "@tsmono/react/components";

import type { PoolRetune } from "./connectionHistory";
import styles from "./ConnectionLogModal.module.css";
import { fmtClock } from "./timeFormat";

interface ConnectionLogModalProps {
  model: string;
  events: ConnectionLimitChange[];
  show: boolean;
  onHide: () => void;
  /** Roles sharing this model's pool — renders the subheader. */
  shared_roles?: string[];
  /** Mid-run config retunes of this pool, interleaved as violet ◆ rows. */
  retunes?: PoolRetune[];
  onViewTimeline?: () => void;
}

const kReasonLabel: Record<ConnectionLimitChange["reason"], string> = {
  slow_start: "slow start",
  steady_state_up: "steady up",
  rate_limit: "rate limit",
  manual: "manual",
};

const kReasonBadge: Record<ConnectionLimitChange["reason"], string> = {
  slow_start: styles.badgeSlowStart!,
  steady_state_up: styles.badgeSteadyUp!,
  rate_limit: styles.badgeRateLimit!,
  manual: styles.badgeManual!,
};

type RowFilter = "all" | "controller" | "events";

type LogRow =
  | { kind: "controller"; time: number; event: ConnectionLimitChange }
  | { kind: "config"; time: number; retune: PoolRetune };

export const ConnectionLogModal: FC<ConnectionLogModalProps> = ({
  model,
  events,
  show,
  onHide,
  shared_roles,
  retunes,
  onViewTimeline,
}) => {
  const [filter, setFilter] = useState<RowFilter>("all");

  const rows = useMemo<LogRow[]>(() => {
    const all: LogRow[] = [
      ...events.map(
        (event): LogRow => ({ kind: "controller", time: event.timestamp, event })
      ),
      ...(retunes ?? []).map(
        (retune): LogRow => ({ kind: "config", time: retune.timestamp, retune })
      ),
    ];
    // Stable tiebreak: a manual controller entry is the mechanical echo of
    // its ◆ retune — the ◆ cause sorts first, both shown, no dedupe.
    return all.sort(
      (a, b) => a.time - b.time || (a.kind === "config" ? -1 : 1)
    );
  }, [events, retunes]);

  const controllerCount = events.length;
  const eventCount = rows.length - controllerCount;
  const visibleRows =
    filter === "all"
      ? rows
      : rows.filter((row) =>
          filter === "controller"
            ? row.kind === "controller"
            : row.kind !== "controller"
        );

  const showFilters = eventCount > 0;

  return (
    <Modal
      id="connection-log"
      show={show}
      onHide={onHide}
      title={`Connection Log — ${model}`}
      width="min(560px, 90vw)"
      padded={false}
      footer={
        <>
          {onViewTimeline && (
            <button
              type="button"
              className={styles.timelineLink}
              onClick={onViewTimeline}
            >
              <i className="bi bi-graph-up" aria-hidden="true" />
              View on timeline
            </button>
          )}
          <button
            type="button"
            className={clsx("btn", "btn-secondary", "text-size-smaller")}
            onClick={onHide}
          >
            Close
          </button>
        </>
      }
    >
      {((shared_roles && shared_roles.length > 0) || showFilters) && (
        <div className={styles.subheader}>
          {shared_roles && shared_roles.length > 0 && (
            <span className={styles.sharedBy}>
              pool {shared_roles.length > 1 ? "shared" : "used"} by{" "}
              {shared_roles.map((role, i) => (
                <span key={role}>
                  {i > 0 ? ", " : ""}
                  <b>{role}</b>
                </span>
              ))}
            </span>
          )}
          {showFilters && (
            <span className={styles.filters}>
              {(
                [
                  ["all", `All (${rows.length})`],
                  ["controller", `Controller (${controllerCount})`],
                  ["events", `Events (${eventCount})`],
                ] as [RowFilter, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={clsx(
                    styles.filterChip,
                    filter === id && styles.filterChipActive
                  )}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th className={styles.limitHead}>Limit</th>
            <th>What</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, i) => {
            if (row.kind === "config") {
              const retune = row.retune;
              return (
                <tr key={`config-${i}`} className={styles.configRow}>
                  <td className={styles.time}>
                    {fmtClock(new Date(row.time * 1000).toISOString(), true)}
                  </td>
                  <td className={styles.limit}>
                    <span className={styles.oldLimit}>—</span>
                  </td>
                  <td>
                    <span className={clsx(styles.badge, styles.badgeConfig)}>
                      ◆ config
                    </span>
                    <span className={styles.configDetail}>
                      {retune.name} {String(retune.previous)} →{" "}
                      {String(retune.value)} · {retune.author}
                      {retune.reason ? ` — “${retune.reason}”` : ""}
                    </span>
                  </td>
                </tr>
              );
            }
            const e = row.event;
            const down = e.new_limit < e.old_limit;
            return (
              <tr
                key={`controller-${i}`}
                className={
                  e.reason === "rate_limit" ? styles.rateLimitRow : undefined
                }
              >
                <td className={styles.time}>
                  {fmtClock(new Date(e.timestamp * 1000).toISOString(), true)}
                </td>
                <td className={styles.limit}>
                  <span className={styles.oldLimit}>{e.old_limit}</span>
                  <span
                    className={down ? styles.arrowDown : styles.arrowUp}
                    aria-label={down ? "decreased to" : "increased to"}
                  >
                    {down ? "↓" : "↑"}
                  </span>
                  <span className={styles.newLimit}>{e.new_limit}</span>
                </td>
                <td>
                  <span className={clsx(styles.badge, kReasonBadge[e.reason])}>
                    {kReasonLabel[e.reason]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
};
