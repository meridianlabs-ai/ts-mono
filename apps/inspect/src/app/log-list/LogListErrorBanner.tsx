import clsx from "clsx";
import { FC } from "react";

import { ApplicationIcons } from "../appearance/icons";

import styles from "./LogListErrorBanner.module.css";

interface LogListErrorBannerProps {
  message: string;
  /** The underlying failure text (e.g. `error.message`) — shown truncated
   *  beside the headline, in full via the tooltip. The cold state's
   *  ErrorPanel shows message+stack; the warm strip must not swallow the
   *  actual failure entirely. */
  detail?: string;
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
  detail,
  onRetry,
}) => (
  <div className={clsx(styles.banner, "text-size-smaller")} role="alert">
    <i
      className={clsx(ApplicationIcons.error, styles.icon)}
      aria-hidden="true"
    />
    <div className={styles.message} title={detail}>
      {message}
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
    <button type="button" className={styles.retry} onClick={onRetry}>
      Retry
    </button>
  </div>
);
