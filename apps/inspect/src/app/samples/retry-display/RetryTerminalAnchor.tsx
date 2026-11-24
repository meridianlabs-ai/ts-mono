import clsx from "clsx";
import { FC } from "react";

import { EvalError, EvalSampleLimit } from "@tsmono/inspect-common";
import { Icon, IconName } from "@tsmono/react/icons";

import { deriveSampleStatus } from "../status/status";

import styles from "./RetryTerminalAnchor.module.css";

export interface RetryTerminalAnchorProps {
  retryCount: number;
  error?: EvalError | null;
  limit?: EvalSampleLimit | null;
}

type Outcome = "success" | "error" | "cancelled" | "limit";

const deriveOutcome = (
  error?: EvalError | null,
  limit?: EvalSampleLimit | null
): Outcome => {
  const status = deriveSampleStatus(true, error?.message);
  if (status === "error" || status === "cancelled") {
    return status;
  }
  return limit ? "limit" : "success";
};

const markerByOutcome: Record<Outcome, string> = {
  success: styles.markerSuccess,
  error: styles.markerError,
  cancelled: styles.markerCancelled,
  limit: styles.markerLimit,
};

const headlineByOutcome: Record<Outcome, string> = {
  success: styles.headlineSuccess,
  error: styles.headlineError,
  cancelled: styles.headlineCancelled,
  limit: styles.headlineLimit,
};

// Orientation only — the final run is the sample the user is already
// viewing. Deliberately not a link, no score, no chevron.
export const RetryTerminalAnchor: FC<RetryTerminalAnchorProps> = ({
  retryCount,
  error,
  limit,
}) => {
  const outcome = deriveOutcome(error, limit);
  const retriesLabel = retryCount === 1 ? "1 retry" : `${retryCount} retries`;

  const headline =
    outcome === "error"
      ? "This run failed"
      : outcome === "cancelled"
        ? "This run was cancelled"
        : outcome === "limit"
          ? `This run hit its ${limit?.type} limit`
          : "This run succeeded";

  const icon: IconName =
    outcome === "error"
      ? "close"
      : outcome === "cancelled"
        ? "changeRemove"
        : outcome === "limit"
          ? "exclamation"
          : "confirm";

  return (
    <div className={styles.row}>
      <span
        className={clsx(styles.marker, markerByOutcome[outcome])}
        aria-hidden="true"
      >
        <Icon name={icon} />
      </span>
      <div className={styles.copy}>
        <span
          className={clsx(styles.headline, headlineByOutcome[outcome])}
          title={limit?.reason ?? undefined}
        >
          {headline}
        </span>
        <span
          className={styles.detail}
        >{`after ${retriesLabel} — the sample you're viewing`}</span>
      </div>
    </div>
  );
};
