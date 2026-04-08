import { FC } from "react";

import {
  useEventNodes,
  type EventNode,
  type EventType,
} from "@tsmono/inspect-components/transcript";

import { Event } from "../../types/api-types";

import { TranscriptViewNodes } from "./TranscriptViewNodes";

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
  // The list of events that have been collapsed
  const { eventNodes, defaultCollapsedIds } = useEventNodes(
    events || [],
    false
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
    />
  );
};
