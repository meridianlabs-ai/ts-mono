import { FC, useCallback } from "react";

import {
  TranscriptViewNodes,
  useEventNodes,
  type EventNode,
  type EventType,
} from "@tsmono/inspect-components/transcript";

import { useStore } from "../state/store";
import { Event } from "../types/api-types";

interface TranscriptViewProps {
  id: string;
  events?: Event[];
  nodeFilter?: (node: EventNode<EventType>[]) => EventNode<EventType>[];
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  initialEventId?: string | null;
  className?: string | string[];
}

export const TranscriptView: FC<TranscriptViewProps> = ({
  id,
  events,
  nodeFilter,
  scrollRef,
  initialEventId,
  className,
}) => {
  const { eventNodes, defaultCollapsedIds } = useEventNodes(
    events || [],
    false
  );

  const collapsedEvents = useStore((state) => state.transcriptCollapsedEvents);
  const setTranscriptCollapsedEvent = useStore(
    (state) => state.setTranscriptCollapsedEvent
  );

  const onCollapse = useCallback(
    (scope: string, nodeId: string, collapsed: boolean) => {
      setTranscriptCollapsedEvent(scope, nodeId, collapsed);
    },
    [setTranscriptCollapsedEvent]
  );

  return (
    <TranscriptViewNodes
      id={id}
      eventNodes={eventNodes}
      defaultCollapsedIds={defaultCollapsedIds}
      nodeFilter={nodeFilter}
      scrollRef={scrollRef}
      initialEventId={initialEventId}
      className={className}
      collapsedEvents={collapsedEvents}
      onCollapse={onCollapse}
    />
  );
};
