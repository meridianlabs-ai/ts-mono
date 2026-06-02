import clsx from "clsx";
import { FC } from "react";

import styles from "./PulsingDots.module.css";

interface PulsingDotsProps {
  text?: string;
  /** Render the text visibly below the dots (default: screen-reader only). */
  showText?: boolean;
  dotsCount?: number;
  subtle?: boolean;
  size?: "small" | "medium" | "large";
  className?: string | string[];
}

export const PulsingDots: FC<PulsingDotsProps> = ({
  text = "Loading...",
  showText = false,
  dotsCount = 3,
  subtle = true,
  size = "small",
  className,
}) => {
  return (
    <div
      className={clsx(
        styles.container,
        size === "small"
          ? styles.small
          : size === "medium"
            ? styles.medium
            : styles.large,
        className
      )}
      role="status"
    >
      {showText && <span className={styles.label}>{text}</span>}
      <div className={styles.dotsContainer}>
        {Array.from({ length: dotsCount }, (_, index) => (
          <div
            key={`dot-${index}`}
            className={clsx(
              styles.dot,
              subtle ? styles.subtle : styles.primary
            )}
            style={{ animationDelay: `${index * 0.2}s` }}
          />
        ))}
      </div>
      {!showText && <span className={styles.visuallyHidden}>{text}</span>}
    </div>
  );
};
