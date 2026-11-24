import { EvalSample } from "@tsmono/inspect-common";
import { PulsingDots } from "@tsmono/react/components";
import { Icon, IconName } from "@tsmono/react/icons";

import { SampleSummary } from "../../../client/api/types";
import { errorType } from "../error/error";

import styles from "./status.module.css";

type SampleStatus = "running" | "ok" | "error" | "cancelled";
export const deriveSampleStatus = (
  completed?: boolean,
  error?: string | null
): SampleStatus => {
  if (error) {
    return errorType(error) === "CancelledError" ? "cancelled" : "error";
  }
  // Only an explicit `false` indicates running. Omitted/undefined is
  // treated as completed: older logs (pre-Apr 2025) and stale buffer
  // entries may lack the field but represent finished samples.
  return completed === false ? "running" : "ok";
};

export const isCancelled = (sample: SampleSummary | EvalSample): boolean => {
  if ("error" in sample && sample.error) {
    if (typeof sample.error === "string") {
      return errorType(sample.error) === "CancelledError";
    }
    return errorType(sample.error.message) === "CancelledError";
  }
  return false;
};

/** Sortable string value for status columns.
 *  Prefix gives desired sort order (started → error → cancelled → success);
 *  error rows additionally include the error type for sub-sorting. */
export const kDefaultSampleSortValue = "3:ok";
export const statusSortValue = (
  status: SampleStatus,
  error?: string | null
): string => {
  switch (status) {
    case "running":
      return "0:running";
    case "error":
      return `1:error:${errorType(error)}`;
    case "cancelled":
      return "2:cancelled";
    default:
      return kDefaultSampleSortValue;
  }
};

interface SampleStatusIconProps {
  status: SampleStatus;
}

export const SampleStatusIcon = ({ status }: SampleStatusIconProps) => {
  if (status === "running") {
    return (
      <div className={styles.statusCell}>
        <PulsingDots subtle={false} />
      </div>
    );
  }

  const icon: IconName =
    status === "error"
      ? "error"
      : status === "cancelled"
        ? "cancel"
        : "success";

  const colorClass =
    status === "error"
      ? styles.error
      : status === "cancelled"
        ? styles.cancelled
        : styles.success;

  return (
    <div className={styles.statusCell}>
      <Icon name={icon} className={colorClass} />
    </div>
  );
};
