import clsx from "clsx";
import { FC } from "react";

import type { ConnectionLimitChange } from "@tsmono/inspect-common/types";

import styles from "./ConnectionChange.module.css";

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

export interface LimitTransitionProps {
  oldLimit: number;
  newLimit: number;
}

/**
 * `old ↓/↑ new` connection-limit transition — the Connection Log modal and
 * the Timeline history render the same event with the same treatment.
 */
export const LimitTransition: FC<LimitTransitionProps> = ({
  oldLimit,
  newLimit,
}) => {
  const down = newLimit < oldLimit;
  return (
    <span className={styles.transition}>
      <span className={styles.oldLimit}>{oldLimit}</span>
      <span
        className={down ? styles.arrowDown : styles.arrowUp}
        aria-label={down ? "decreased to" : "increased to"}
      >
        {down ? "↓" : "↑"}
      </span>
      <span className={styles.newLimit}>{newLimit}</span>
    </span>
  );
};

export interface ConnectionReasonBadgeProps {
  reason: ConnectionLimitChange["reason"];
  /** Steps aggregated into this entry — > 1 renders an ×N suffix. */
  count?: number;
}

export const ConnectionReasonBadge: FC<ConnectionReasonBadgeProps> = ({
  reason,
  count,
}) => (
  <span className={clsx(styles.badge, kReasonBadge[reason])}>
    {kReasonLabel[reason]}
    {count !== undefined && count > 1 ? ` ×${count}` : ""}
  </span>
);
