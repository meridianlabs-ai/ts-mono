import clsx from "clsx";
import { FC } from "react";

import { ApplicationIcons } from "../appearance/icons";

import styles from "./LogListErrorBanner.module.css";

interface LogListErrorBannerProps {
  message: string;
  onRetry: () => void;
}

/**
 * Non-blocking failure strip for the log list's warm-error state: a sync or
 * listing read failed while there are still rows to show, so the grid stays
 * mounted (scroll, selection, and find state survive) and the failure
 * surfaces here instead of replacing the list — the cold state (nothing to
 * show) keeps the full-panel treatment (see LogsPanel).
 */
export const LogListErrorBanner: FC<LogListErrorBannerProps> = ({
  message,
  onRetry,
}) => (
  <div className={clsx(styles.banner, "text-size-smaller")} role="alert">
    <i
      className={clsx(ApplicationIcons.error, styles.icon)}
      aria-hidden="true"
    />
    <div className={styles.message}>{message}</div>
    <button type="button" className={styles.retry} onClick={onRetry}>
      Retry
    </button>
  </div>
);
