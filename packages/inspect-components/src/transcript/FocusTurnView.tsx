import { FC, ReactNode } from "react";

import { FocusTabContext } from "./FocusTabContext";
import styles from "./FocusTurnView.module.css";
import type { FocusTurnNavigation } from "./hooks/useFocusTurnNavigation";
import { TranscriptVirtualList } from "./TranscriptVirtualList";
import { TurnHeader } from "./TurnHeader";

interface FocusTurnViewProps {
  nav: FocusTurnNavigation;
  eventId: string | null;
  /**
   * Optional chrome (e.g. the breadcrumb navbar) rendered above the scroll
   * area, outside the scroll container (a sibling, not nested in it).
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
    goToTurn,
    laneName,
    laneCount,
    onPrevAgent,
    onNextAgent,
    hasPrevAgent,
    hasNextAgent,
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
              onGoToTurn={goToTurn}
              hasPrev={turnIndex > 0}
              hasNext={turnIndex < totalTurns - 1}
              agentLane={
                laneCount > 1
                  ? {
                      name: laneName,
                      hasPrev: hasPrevAgent,
                      hasNext: hasNextAgent,
                      onPrev: onPrevAgent,
                      onNext: onNextAgent,
                    }
                  : undefined
              }
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
