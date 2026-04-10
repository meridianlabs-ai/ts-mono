import clsx from "clsx";
import { FC, useCallback, useMemo, useRef } from "react";

import {
  kTranscriptCollapseScope,
  TranscriptLayout,
} from "@tsmono/inspect-components/transcript";

import { useStore } from "../../../state/store";
import { ScanResultData } from "../../types";

import styles from "./TranscriptPanel.module.css";

interface TranscriptPanelProps {
  id: string;
  resultData?: ScanResultData;
}

/**
 * Lightweight transcript panel for scanner results.
 *
 * Uses `TranscriptLayout` without outline or swimlanes — the scanner context
 * only needs a flat event list. The root "scan" span is stripped at the event
 * level so the layout sees only the inner events.
 */
export const TranscriptPanel: FC<TranscriptPanelProps> = ({
  id,
  resultData,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Strip the root scan span wrapper at the flat event level.
  // If the first event is span_begin and the last is span_end, they are the
  // scanner's own bookend — remove them so TranscriptLayout sees only inner events.
  const events = useMemo(() => {
    const raw = resultData?.scanEvents || [];
    const first = raw[0];
    const last = raw[raw.length - 1];
    if (
      first &&
      last &&
      first.event === "span_begin" &&
      last.event === "span_end"
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  }, [resultData?.scanEvents]);

  const collapsedEvents = useStore((state) => state.transcriptCollapsedEvents);
  const setTranscriptCollapsedEvent = useStore(
    (state) => state.setTranscriptCollapsedEvent
  );
  const setTranscriptCollapsedEvents = useStore(
    (state) => state.setTranscriptCollapsedEvents
  );

  const onCollapseTranscript = useCallback(
    (nodeId: string, collapsed: boolean) => {
      setTranscriptCollapsedEvent(kTranscriptCollapseScope, nodeId, collapsed);
    },
    [setTranscriptCollapsedEvent]
  );

  const onSetTranscriptCollapsed = useCallback(
    (ids: Record<string, boolean>) => {
      setTranscriptCollapsedEvents(kTranscriptCollapseScope, ids);
    },
    [setTranscriptCollapsedEvents]
  );

  return (
    <div ref={scrollRef} className={clsx(styles.container)}>
      <TranscriptLayout
        events={events}
        scrollRef={scrollRef}
        listId={id}
        showSwimlanes={false}
        collapseState={{
          transcript: collapsedEvents[kTranscriptCollapseScope],
          onCollapseTranscript,
          onSetTranscriptCollapsed,
        }}
      />
    </div>
  );
};
