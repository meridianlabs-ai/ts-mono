import { FC, RefObject, useCallback, useEffect, useState } from "react";

import { EvalRetryError } from "@tsmono/inspect-common";
import { Card, CardBody, CardHeader } from "@tsmono/react/components";

import {
  RetryAttemptCard,
  RetryView,
} from "./retry-display/RetryAttemptCard";
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
  const [viewByIndex, setViewByIndex] = useState<Record<number, RetryView>>({});

  // Reset accordion/view state when switching to a different sample (the same
  // component instance can be reused across samples on the inline display path).
  useEffect(() => {
    setExpandedIndex(retries.length - 1);
    setViewByIndex({});
  }, [id, retries.length]);

  const onToggleOpen = useCallback((index: number) => {
    setExpandedIndex((cur) => (cur === index ? null : index));
  }, []);

  const onViewChange = useCallback((index: number, view: RetryView) => {
    setViewByIndex((prev) => ({ ...prev, [index]: view }));
  }, []);

  return (
    <Card className={styles.card}>
      <CardHeader>
        <span className={styles.sectionLabel}>Retry Attempts</span>
      </CardHeader>
      <CardBody>
        <div className={styles.timeline}>
          <div className={styles.rail} aria-hidden="true" />
          <div className={styles.items}>
            {retries.map((retry, index) => (
              <div className={styles.row} key={index}>
                <div className={styles.dotGutter} aria-hidden="true">
                  <span className={styles.statusDot} />
                </div>
                <RetryAttemptCard
                  retry={retry}
                  attemptNumber={index + 1}
                  isOpen={expandedIndex === index}
                  view={viewByIndex[index] ?? "error"}
                  onToggleOpen={() => onToggleOpen(index)}
                  onViewChange={(view) => onViewChange(index, view)}
                  listId={`sample-error-retries-${id}-${index}`}
                  scrollRef={scrollRef}
                />
              </div>
            ))}
            <RetryTerminalAnchor retryCount={retries.length} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
};
