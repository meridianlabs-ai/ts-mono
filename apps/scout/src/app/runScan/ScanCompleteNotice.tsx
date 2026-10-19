import { clsx } from "clsx";
import { FC } from "react";
import { Link } from "react-router";

import { Icon } from "@tsmono/react/icons";

import { Status } from "../../types/api-types";

import styles from "./ScanCompleteNotice.module.css";

const sumScanners = (status: Status, key: "results" | "errors"): number =>
  Object.values(status.summary.scanners).reduce(
    (sum, scanner) => sum + scanner[key],
    0
  );

const plural = (count: number, noun: string): string =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

interface Props {
  status: Status;
  resultsHref: string;
  onDismiss: () => void;
}

export const ScanCompleteNotice: FC<Props> = ({
  status,
  resultsHref,
  onDismiss,
}) => {
  const results = sumScanners(status, "results");
  const errors = sumScanners(status, "errors");
  const hasErrors = errors > 0 || status.errors.length > 0;
  const failed = !status.complete || hasErrors;
  // A scan with errors stays incomplete (it can be resumed), so "finished
  // with errors" rather than "ended without completing".
  const title = status.complete
    ? hasErrors
      ? "Scan complete with errors"
      : "Scan complete"
    : hasErrors
      ? "Scan finished with errors"
      : "Scan ended without completing";

  return (
    <div
      role={failed ? "alert" : "status"}
      className={clsx(styles.notice, failed ? styles.failed : styles.succeeded)}
    >
      <Icon name={failed ? "error" : "success"} className={styles.icon} />
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        <div className={styles.counts}>
          {plural(results, "result")}, {plural(errors, "error")}
        </div>
      </div>
      <Link to={resultsHref} className={styles.link}>
        View results
      </Link>
      <button
        type="button"
        className={styles.closeButton}
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <Icon name="close" />
      </button>
    </div>
  );
};
