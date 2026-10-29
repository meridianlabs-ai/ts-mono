import { FC } from "react";

import type { SwarmEvent } from "@tsmono/inspect-common/types";
import { ExpandablePanel, JSONPanel } from "@tsmono/react/components";
import { formatDateTime } from "@tsmono/util";

import { EventPanel } from "./event/EventPanel";
import styles from "./SwarmEventView.module.css";
import { EventNode } from "./types";

interface SwarmEventViewProps {
  eventNode: EventNode<SwarmEvent>;
  className?: string;
}

/**
 * Renders a SwarmEvent: its kind and member over its data. The swarm owns the
 * kinds and the format of `data`, so no kind is interpreted here.
 */
export const SwarmEventView: FC<SwarmEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title={`Swarm: ${event.kind}`}
      headerExtra={
        event.member ? (
          <span className={styles.member}>{event.member}</span>
        ) : undefined
      }
      className={className}
      subTitle={
        event.timestamp ? formatDateTime(new Date(event.timestamp)) : undefined
      }
      icon="info"
    >
      <ExpandablePanel id={`${eventNode.id}-swarm`} collapse={true}>
        <JSONPanel data={event.data} className={styles.panel} />
      </ExpandablePanel>
    </EventPanel>
  );
};
