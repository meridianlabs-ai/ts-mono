import clsx from "clsx";
import { FC, RefObject, useCallback, useMemo, useState } from "react";

import { EvalRetryError } from "@tsmono/inspect-common";
import {
  TranscriptCollapseState,
  TranscriptLayout,
} from "@tsmono/inspect-components/transcript";
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

  // Pre-seed collapsed state for state/store events so their
  // collapsibleContent bodies start hidden (matching main transcript
  // where they're hidden inside collapsed parent containers).
  const initialCollapsed = useMemo(() => {
    const ids: Record<string, boolean> = {};
    for (const event of retry.events || []) {
      if (
        (event.event === "state" || event.event === "store") &&
        event.uuid
      ) {
        ids[event.uuid] = true;
      }
    }
    return ids;
  }, [retry.events]);

  // Lightweight local collapse state for transcript event toggling.
  // bulkCollapse applies defaults on first render, then clears itself
  // so user toggles aren't overwritten — mirroring the main transcript pattern.
  const [transcriptCollapsed, setTranscriptCollapsed] = useState<
    Record<string, boolean> | undefined
  >(undefined);
  const [bulkCollapse, setBulkCollapse] = useState<
    "collapse" | "expand" | undefined
  >("expand");

  // Always layer initialCollapsed under the current state so state/store
  // events default to collapsed. User toggles override via spread order.
  const effectiveCollapsed = useMemo(
    () =>
      transcriptCollapsed
        ? { ...initialCollapsed, ...transcriptCollapsed }
        : Object.keys(initialCollapsed).length > 0
          ? initialCollapsed
          : undefined,
    [transcriptCollapsed, initialCollapsed],
  );

  const collapseState = useMemo<TranscriptCollapseState>(
    () => ({
      transcript: effectiveCollapsed,
      onCollapseTranscript: (nodeId: string, collapsed: boolean) =>
        setTranscriptCollapsed((prev) => ({
          ...prev,
          [nodeId]: collapsed,
        })),
      onSetTranscriptCollapsed: (ids: Record<string, boolean>) => {
        setTranscriptCollapsed(ids);
        setBulkCollapse(undefined);
      },
    }),
    [effectiveCollapsed],
  );

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
              showSwimlanes={false}
              collapseState={collapseState}
              bulkCollapse={bulkCollapse}
              eventNodeContext={{ inlineExpansionUX: true }}
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
    className={styles.ansi}
  />
);
