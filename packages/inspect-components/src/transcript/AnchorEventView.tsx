import { FC } from "react";

import type { AnchorEvent } from "@tsmono/inspect-common/types";
import { MetaDataGrid } from "@tsmono/inspect-components/content";
import { formatDateTime } from "@tsmono/util";

import styles from "./BranchEventView.module.css";
import { EventPanel } from "./event/EventPanel";
import { formatTitle } from "./event/utils";
import { TranscriptIcons } from "./icons";
import { EventNode } from "./types";

interface AnchorEventViewProps {
  eventNode: EventNode<AnchorEvent>;
  className?: string;
}

export const AnchorEventView: FC<AnchorEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  const data: Record<string, unknown> = { anchor_id: event.anchor_id };
  if (event.source) data["source"] = event.source;

  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title={formatTitle("Anchor", undefined, event.working_start)}
      className={className}
      subTitle={formatDateTime(new Date(event.timestamp))}
      icon={TranscriptIcons.info}
    >
      <MetaDataGrid entries={data} className={styles.panel} />
    </EventPanel>
  );
};
