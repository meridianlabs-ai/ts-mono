import clsx from "clsx";
import { FC } from "react";

import { PulsingEllipsis } from "@tsmono/react/components";

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
      aria-live="polite"
      className={clsx(
        styles.bar,
        attempt === undefined && styles.barLabelOnly,
        className
      )}
    >
      <PulsingEllipsis text="Generating" />
      {attempt !== undefined && (
        <span className={styles.attempt}>attempt {attempt}</span>
      )}
    </div>
  );
};
