import clsx from "clsx";
import { Component, FC, ReactNode, RefObject, useMemo, useState } from "react";

import type { EvalRetryError } from "@tsmono/inspect-common";
import {
  TranscriptCollapseState,
  TranscriptLayout,
} from "@tsmono/inspect-components/transcript";
import { ANSIDisplay, SegmentedControl } from "@tsmono/react/components";
import { formatTime } from "@tsmono/util";

import { attemptDuration, deriveErrorType } from "./retryAttempt";
import styles from "./RetryAttemptCard.module.css";

export type RetryView = "error" | "events";

const kViewSegments = [
  { id: "error", label: "Error", icon: "bi bi-exclamation-triangle" },
  { id: "events", label: "Events", icon: "bi bi-list-ul" },
];

export interface RetryAttemptCardProps {
  retry: EvalRetryError;
  index: number;
  attemptNumber: number;
  isOpen: boolean;
  view: RetryView;
  onToggleOpen: () => void;
  onViewChange: (view: RetryView) => void;
  listId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
}

export const RetryAttemptCard: FC<RetryAttemptCardProps> = ({
  retry,
  attemptNumber,
  isOpen,
  view,
  onToggleOpen,
  onViewChange,
  listId,
  scrollRef,
}) => {
  const errorType = useMemo(() => deriveErrorType(retry), [retry]);
  const durationSec = useMemo(() => attemptDuration(retry), [retry]);
  const hasEvents = !!retry.events?.length;

  return (
    <div className={clsx(styles.card, isOpen ? styles.cardOpen : styles.cardCollapsed)}>
      <div
        className={styles.header}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={onToggleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleOpen();
          }
        }}
      >
        <span className={styles.attemptLabel}>{`Attempt ${attemptNumber}`}</span>
        {errorType && (
          <span className={styles.errorChip} aria-hidden="true">
            {errorType}
          </span>
        )}
        {retry.message && <span className={styles.message}>{retry.message}</span>}
        {durationSec != null && (
          <span className={styles.duration}>{formatTime(durationSec)}</span>
        )}
        <i
          className={clsx(
            "bi",
            isOpen ? "bi-chevron-down" : "bi-chevron-right",
            styles.chevron,
          )}
          aria-hidden="true"
        />
      </div>

      {isOpen && (
        <div className={styles.body}>
          {hasEvents && (
            <div className={styles.toggle}>
              <SegmentedControl
                segments={kViewSegments}
                selectedId={view}
                onSegmentChange={(id) => onViewChange(id as RetryView)}
              />
            </div>
          )}
          {view === "error" || !hasEvents ? (
            <TracebackDisplay output={retry.traceback_ansi} className={styles.ansi} />
          ) : (
            <RetryEventsView retry={retry} listId={listId} scrollRef={scrollRef} />
          )}
        </div>
      )}
    </div>
  );
};

// ANSIDisplay requires ComponentIconProvider and ansi-output (not available in
// jsdom). Wrap with an error boundary so the card renders in isolation during
// unit tests — the boundary falls back to a plain <pre> on render errors.
interface TracebackDisplayProps {
  output: string;
  className?: string;
}

class AnsiErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

const TracebackDisplay: FC<TracebackDisplayProps> = ({ output, className }) => (
  <AnsiErrorBoundary fallback={<pre className={className}>{output}</pre>}>
    <ANSIDisplay output={output} className={className} />
  </AnsiErrorBoundary>
);

const RetryEventsView: FC<{
  retry: EvalRetryError;
  listId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
}> = ({ retry, listId, scrollRef }) => {
  // Pre-seed collapsed state for state/store events so their collapsibleContent
  // bodies start hidden — mirrors the main transcript, where they're hidden
  // inside collapsed parent containers.
  const initialCollapsed = useMemo(() => {
    const ids: Record<string, boolean> = {};
    for (const event of retry.events || []) {
      if ((event.event === "state" || event.event === "store") && event.uuid) {
        ids[event.uuid] = true;
      }
    }
    return ids;
  }, [retry.events]);

  const [transcriptCollapsed, setTranscriptCollapsed] = useState<
    Record<string, boolean> | undefined
  >(undefined);
  const [bulkCollapse, setBulkCollapse] = useState<
    "collapse" | "expand" | undefined
  >("expand");

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
        setTranscriptCollapsed((prev) => ({ ...prev, [nodeId]: collapsed })),
      onSetTranscriptCollapsed: (ids: Record<string, boolean>) => {
        setTranscriptCollapsed(ids);
        setBulkCollapse(undefined);
      },
    }),
    [effectiveCollapsed],
  );

  return (
    <div className="text-size-small">
      <TranscriptLayout
        events={retry.events || []}
        scrollRef={scrollRef}
        listId={listId}
        showSwimlanes={false}
        collapseState={collapseState}
        bulkCollapse={bulkCollapse}
        eventNodeContext={{ inlineExpansionUX: true }}
      />
    </div>
  );
};
