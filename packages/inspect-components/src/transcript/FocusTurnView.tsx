import { FC, ReactNode } from "react";

import { FocusTabContext } from "./FocusTabContext";
import styles from "./FocusTurnView.module.css";
import type { FocusTurnNavigation } from "./hooks/useFocusTurnNavigation";
// Import the memo wrapper (not TranscriptVirtualListComponent directly): it
// owns the module-init order of the TranscriptVirtualList↔Component import
// cycle, so importing the raw component here would hit a TDZ at load.
import { TranscriptVirtualList } from "./TranscriptVirtualList";
import { TurnHeader } from "./TurnHeader";

interface FocusTurnViewProps {
  /** Output of `useFocusTurnNavigation`. */
  nav: FocusTurnNavigation;
  eventId: string | null;
  /**
   * Optional chrome (e.g. the breadcrumb navbar) rendered above the scroll
   * area. It sits outside the scroll container, so the sticky-header offset
   * inside the transcript is unaffected.
   */
  header?: ReactNode;
}

/**
 * Renders the focused turn (open-in-new-tab single-event page): the turn-nav
 * strip plus the turn's events, fully expanded, with the transcript's own
 * renderer but without the list's card/gutter chrome. Shared by the inspect and
 * scout single-event pages, which supply their own loading/error chrome.
 */
export const FocusTurnView: FC<FocusTurnViewProps> = ({
  nav,
  eventId,
  header,
}) => {
  const {
    scrollRef,
    listHandle,
    slice,
    turnInfo,
    turnIndex,
    totalTurns,
    onPrev,
    onNext,
    focusTab,
  } = nav;

  return (
    <FocusTabContext.Provider value={focusTab}>
      <div className={styles.root}>
        {header}
        <div className={styles.container} ref={scrollRef}>
          {turnIndex !== -1 && (
            <TurnHeader
              turnNumber={turnInfo?.turnNumber ?? turnIndex + 1}
              totalTurns={turnInfo?.totalTurns ?? totalTurns}
              onPrev={onPrev}
              onNext={onNext}
              hasPrev={turnIndex > 0}
              hasNext={turnIndex < totalTurns - 1}
            />
          )}
          <TranscriptVirtualList
            id={`event-${eventId}`}
            listHandle={listHandle}
            eventNodes={slice}
            disableVirtualization={true}
            // Slice starts at the focused model, so the per-node back-scan would
            // compute hasToolEvents=false and the model would inline + expand its
            // input tool messages. Force true so it renders the compact summary.
            eventNodeContext={{ hasToolEvents: true }}
          />
        </div>
      </div>
    </FocusTabContext.Provider>
  );
};
