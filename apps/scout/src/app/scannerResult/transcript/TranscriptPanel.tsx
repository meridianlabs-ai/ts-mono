import clsx from "clsx";
import { FC, useCallback, useRef } from "react";

import {
  EventNode,
  kTranscriptCollapseScope,
  TranscriptViewNodes,
  useEventNodes,
  type EventType,
} from "@tsmono/inspect-components/transcript";

import { useStore } from "../../../state/store";
import { ScanResultData } from "../../types";

import styles from "./TranscriptPanel.module.css";

interface TranscriptPanelProps {
  id: string;
  resultData?: ScanResultData;
  nodeFilter?: (node: EventNode<EventType>[]) => EventNode<EventType>[];
}

export const TranscriptPanel: FC<TranscriptPanelProps> = ({
  id,
  resultData,
  nodeFilter,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { eventNodes, defaultCollapsedIds } = useEventNodes(
    resultData?.scanEvents || [],
    false
  );

  const collapsedEvents = useStore((state) => state.transcriptCollapsedEvents);
  const setTranscriptCollapsedEvent = useStore(
    (state) => state.setTranscriptCollapsedEvent
  );

  const collapsedTranscript = collapsedEvents[kTranscriptCollapseScope];

  const onCollapseTranscript = useCallback(
    (nodeId: string, collapsed: boolean) => {
      setTranscriptCollapsedEvent(kTranscriptCollapseScope, nodeId, collapsed);
    },
    [setTranscriptCollapsedEvent]
  );

  return (
    <div ref={scrollRef} className={clsx(styles.container)}>
      <TranscriptViewNodes
        id={id}
        eventNodes={eventNodes}
        defaultCollapsedIds={defaultCollapsedIds}
        nodeFilter={nodeFilter}
        scrollRef={scrollRef}
        collapsedTranscript={collapsedTranscript}
        onCollapseTranscript={onCollapseTranscript}
      />
    </div>
  );
};
