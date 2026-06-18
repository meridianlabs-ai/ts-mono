import clsx from "clsx";
import { FC, ReactNode } from "react";

import { Spinner } from "@tsmono/react/components";

import styles from "./LogListFooter.module.css";

interface LogListFooterProps {
  itemCount: number;
  itemCountLabel?: string;
  filteredCount?: number;
  progressText?: string;
  progressBar?: ReactNode;
}

export const LogListFooter: FC<LogListFooterProps> = ({
  itemCount,
  itemCountLabel,
  filteredCount,
  progressText,
  progressBar,
}) => {
  const effectiveItemCount = filteredCount ?? itemCount;
  const label = itemCountLabel || "items";

  const countText =
    effectiveItemCount === 0
      ? ""
      : filteredCount !== undefined && filteredCount !== itemCount
        ? `${effectiveItemCount.toLocaleString()} / ${itemCount.toLocaleString()} ${label}`
        : `${effectiveItemCount.toLocaleString()} ${label}`;

  return (
    <div className={clsx("text-size-smaller", styles.footer)}>
      <div className={clsx(styles.left)}>
        {progressText ? (
          <div className={clsx(styles.spinnerContainer)}>
            <Spinner className={styles.spinner} label={`${progressText}...`} />
            <div className={clsx("text-style-secondary", styles.label)}>
              {progressText}...
            </div>
          </div>
        ) : (
          (progressBar ?? null)
        )}
      </div>
      <div className={clsx(styles.center)} />
      <div className={clsx(styles.right)}>
        <div>{countText}</div>
      </div>
    </div>
  );
};
