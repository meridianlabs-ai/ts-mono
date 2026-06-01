import clsx from "clsx";
import { FC } from "react";

import styles from "./GeneratingIndicator.module.css";

interface GeneratingIndicatorProps {
  /** Agentic-loop attempt number. Omits the tag when not provided. */
  attempt?: number;
  className?: string;
}

export const GeneratingIndicator: FC<GeneratingIndicatorProps> = ({
  attempt,
  className,
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        styles.bar,
        attempt === undefined && styles.barLabelOnly,
        className
      )}
    >
      <span className={styles.label}>
        Generating
        <span className={styles.ell} aria-hidden="true">
          <i>.</i>
          <i>.</i>
          <i>.</i>
        </span>
      </span>
      {attempt !== undefined && (
        <span className={styles.attempt}>attempt {attempt}</span>
      )}
    </div>
  );
};
