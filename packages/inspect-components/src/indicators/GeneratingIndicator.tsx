import clsx from "clsx";
import { FC } from "react";

import { PulsingEllipsis } from "@tsmono/react/components";

import styles from "./GeneratingIndicator.module.css";

interface GeneratingIndicatorProps {
  /** Activity label. Defaults to "generating". */
  label?: string;
  /** Agentic-loop attempt number. Omits the tag when not provided. */
  attempt?: number;
  className?: string;
}

export const GeneratingIndicator: FC<GeneratingIndicatorProps> = ({
  label = "generating",
  attempt,
  className,
}) => {
  return (
    <div
      aria-live="polite"
      className={clsx(
        styles.bar,
        attempt === undefined && styles.barLabelOnly,
        className
      )}
    >
      <PulsingEllipsis text={label} />
      {attempt !== undefined && (
        <span className={styles.attempt}>attempt {attempt}</span>
      )}
    </div>
  );
};
