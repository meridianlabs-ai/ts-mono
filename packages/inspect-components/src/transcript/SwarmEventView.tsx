import { FC } from "react";

import type { SwarmEvent } from "@tsmono/inspect-common/types";
import {
  ContentText,
  ExpandablePanel,
  JSONPanel,
} from "@tsmono/react/components";
import { formatDateTime } from "@tsmono/util";

import { EventPanel } from "./event/EventPanel";
import { eventPayload } from "./eventText";
import styles from "./SwarmEventView.module.css";
import { EventNode } from "./types";

interface SwarmEventViewProps {
  eventNode: EventNode<SwarmEvent>;
  className?: string;
}

/**
 * Renders a SwarmEvent: its kind and member over its fields as JSON, the text
 * search indexes. The swarm owns the kinds and the format of `data`, so no
 * kind is interpreted here.
 */
export const SwarmEventView: FC<SwarmEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title="Swarm:"
      headerExtra={
        <>
          <ContentText text={event.kind} />
          {event.member ? (
            <span className={styles.member}>
              <ContentText text={event.member} />
            </span>
          ) : null}
        </>
      }
      className={className}
      subTitle={
        event.timestamp ? formatDateTime(new Date(event.timestamp)) : undefined
      }
      icon="info"
    >
      <ExpandablePanel id={`${eventNode.id}-swarm`} collapse={true}>
        <JSONPanel data={eventPayload(event)} className={styles.panel} />
      </ExpandablePanel>
    </EventPanel>
  );
};
