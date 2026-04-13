import clsx from "clsx";
import { FC, RefObject, useCallback, useMemo, useState } from "react";

import { EvalRetryError } from "@tsmono/inspect-common";
import { TranscriptLayout } from "@tsmono/inspect-components/transcript";
import {
  ANSIDisplay,
  Card,
  CardBody,
  CardHeader,
  SegmentedControl,
  ToolDropdownButton,
} from "@tsmono/react/components";

import styles from "./SampleRetriedErrors.module.css";

type RetryView = "error" | "events";

const kViewSegments = [
  { id: "error", label: "Error" },
  { id: "events", label: "Events" },
];

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<RetryView>("error");

  const onSegmentChange = useCallback((segmentId: string) => {
    setView(segmentId as RetryView);
  }, []);

  const dropdownItems = useMemo(() => {
    const items: Record<string, () => void> = {};
    retries.forEach((_, index) => {
      items[`Attempt ${index + 1}`] = () => setSelectedIndex(index);
    });
    return items;
  }, [retries]);

  const retry = retries[retries.length === 1 ? 0 : selectedIndex];
  const hasEvents = !!retry.events?.length;

  return (
    <Card className={styles.card}>
      <CardHeader>
        <div className={styles.headerRow}>
          <span>Retry Attempts</span>
          <div className={styles.headerControls}>
            {retries.length > 1 && (
              <ToolDropdownButton
                label={`Attempt ${selectedIndex + 1}`}
                items={dropdownItems}
                className={clsx("text-size-smallest", styles.attemptDropdown)}
              />
            )}
            {hasEvents && (
              <SegmentedControl
                segments={kViewSegments}
                selectedId={view}
                onSegmentChange={onSegmentChange}
              />
            )}
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {view === "error" ? (
          <RetryTraceback retry={retry} />
        ) : (
          <div className="text-size-small">
            <TranscriptLayout
              events={retry.events || []}
              scrollRef={scrollRef}
              listId={`sample-error-retries-${id}`}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
};

const RetryTraceback: FC<{ retry: EvalRetryError }> = ({ retry }) => (
  <ANSIDisplay
    output={retry.traceback_ansi}
    className={clsx("text-size-small", styles.ansi)}
    style={{
      fontSize: "clamp(0.3rem, 1.1vw, 0.8rem)",
      margin: "0.5em 0",
    }}
  />
);
