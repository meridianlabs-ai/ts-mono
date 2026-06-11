import clsx from "clsx";
import { FC, RefObject, useEffect, useState } from "react";

import { EvalRetryError } from "@tsmono/inspect-common";

import { ApplicationIcons } from "../appearance/icons";
import { RetryAttemptCard } from "./retry-display/RetryAttemptCard";
import { RetryTerminalAnchor } from "./retry-display/RetryTerminalAnchor";
import styles from "./SampleRetriedErrors.module.css";

interface SampleRetriedErrorsProps {
  id: string;
  retries: EvalRetryError[];
  scrollRef: RefObject<HTMLDivElement | null>;
}

export const SampleRetriedErrors: FC<SampleRetriedErrorsProps> = ({
  id,
  retries,
  scrollRef,
}) => {
  // Accordion: default to the most recent failure (closest to the success).
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    retries.length - 1,
  );

  // Reset accordion state when switching to a different sample (the same
  // component instance can be reused across samples on the inline display path).
  useEffect(() => {
    setExpandedIndex(retries.length - 1);
  }, [id, retries.length]);

  const onToggleOpen = (index: number) => {
    setExpandedIndex((cur) => (cur === index ? null : index));
  };

  return (
    <div className={styles.panel}>
      <div className={styles.sectionLabel}>Retry Attempts</div>
      <div className={styles.timeline}>
        <div className={styles.rail} aria-hidden="true" />
        <div className={styles.items}>
          {retries.map((retry, index) => (
            <div className={styles.row} key={index}>
              <div className={styles.dotGutter} aria-hidden="true">
                <i className={clsx(ApplicationIcons.error, styles.statusIcon)} />
              </div>
              <RetryAttemptCard
                retry={retry}
                attemptNumber={index + 1}
                isOpen={expandedIndex === index}
                onToggleOpen={() => onToggleOpen(index)}
                listId={`sample-error-retries-${id}-${index}`}
                scrollRef={scrollRef}
              />
            </div>
          ))}
          <RetryTerminalAnchor retryCount={retries.length} />
        </div>
      </div>
    </div>
  );
};
