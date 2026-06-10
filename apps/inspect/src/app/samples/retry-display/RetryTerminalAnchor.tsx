import { FC } from "react";

import styles from "./RetryTerminalAnchor.module.css";

export interface RetryTerminalAnchorProps {
  retryCount: number;
}

// Orientation only — the successful run is the sample the user is already
// viewing. Deliberately not a link, no score, no chevron.
export const RetryTerminalAnchor: FC<RetryTerminalAnchorProps> = ({ retryCount }) => {
  const retriesLabel = retryCount === 1 ? "1 retry" : `${retryCount} retries`;
  return (
    <div className={styles.row}>
      <span className={styles.check} aria-hidden="true">
        <i className="bi bi-check" />
      </span>
      <div className={styles.copy}>
        <span className={styles.success}>This run succeeded</span>
        <span className={styles.detail}>
          {`after ${retriesLabel}`}
        </span>
      </div>
    </div>
  );
};
