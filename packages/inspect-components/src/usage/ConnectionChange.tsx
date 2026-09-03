import clsx from "clsx";
import { FC } from "react";

import type { ConnectionLimitChange } from "@tsmono/inspect-common/types";

import styles from "./ConnectionChange.module.css";

/** One wording per controller reason — shared by the badge here and the
 *  Timeline History rows so the two surfaces cannot drift. */
export const kConnectionReasonLabel: Record<
  ConnectionLimitChange["reason"],
  string
> = {
  slow_start: "slow start",
  steady_state_up: "steady up",
  rate_limit: "rate limit",
  manual: "manual",
};

const kReasonBadge: Record<ConnectionLimitChange["reason"], string> = {
  slow_start: styles.badgeSlowStart,
  steady_state_up: styles.badgeSteadyUp,
  rate_limit: styles.badgeRateLimit,
  manual: styles.badgeManual,
};

export interface LimitTransitionProps {
  oldLimit: number;
  newLimit: number;
}

/** `old ↓/↑ new` connection-limit transition (Connection Log modal). */
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
}

export const ConnectionReasonBadge: FC<ConnectionReasonBadgeProps> = ({
  reason,
}) => (
  <span className={clsx(styles.badge, kReasonBadge[reason])}>
    {kConnectionReasonLabel[reason]}
  </span>
);
