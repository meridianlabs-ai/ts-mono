import clsx from "clsx";
import { FC, RefObject, useMemo, useState } from "react";

import type { EvalRetryError } from "@tsmono/inspect-common";
import {
  TranscriptCollapseState,
  TranscriptLayout,
} from "@tsmono/inspect-components/transcript";
import { ANSIDisplay, ExpandablePanel } from "@tsmono/react/components";
import { formatTime } from "@tsmono/util";

import { attemptDuration, deriveErrorType } from "./retryAttempt";
import styles from "./RetryAttemptCard.module.css";

export interface RetryAttemptCardProps {
  retry: EvalRetryError;
  attemptNumber: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  listId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
}

export const RetryAttemptCard: FC<RetryAttemptCardProps> = ({
  retry,
  attemptNumber,
  isOpen,
  onToggleOpen,
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
        {errorType && <span className={styles.errorChip}>{errorType}</span>}
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
          <div className={styles.sectionHeader}>
            <i
              className={clsx("bi bi-exclamation-triangle", styles.sectionIcon)}
              aria-hidden="true"
            />
            <span>Error</span>
          </div>
          <ExpandablePanel
            id={`retry-error-${listId}`}
            collapse={true}
            className={styles.errorPanel}
          >
            <ANSIDisplay output={retry.traceback_ansi} className={styles.ansi} />
          </ExpandablePanel>

          {hasEvents && (
            <>
              <div
                className={clsx(styles.sectionHeader, styles.sectionHeaderEvents)}
              >
                <i
                  className={clsx("bi bi-list-ul", styles.sectionIcon)}
                  aria-hidden="true"
                />
                <span>Terminal Events</span>
              </div>
              <RetryEventsView
                retry={retry}
                listId={listId}
                scrollRef={scrollRef}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

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
        embedded
        showSwimlanes={false}
        collapseState={collapseState}
        bulkCollapse={bulkCollapse}
        eventNodeContext={{ inlineExpansionUX: true }}
      />
    </div>
  );
};
