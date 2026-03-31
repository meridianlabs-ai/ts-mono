import { FC } from "react";

import { formatDateTime } from "@tsmono/util";

import { BranchEvent } from "../../types/api-types";
import { MetaDataGrid } from "../content/MetaDataGrid";
import { ApplicationIcons } from "../icons";

import styles from "./BranchEventView.module.css";
import { EventPanel } from "./event/EventPanel";
import { formatTitle } from "./event/utils";
import { EventNode } from "./types";

interface BranchEventViewProps {
  eventNode: EventNode<BranchEvent>;
  className?: string | string[];
}

/**
 * Renders the BranchEventView component.
 */
export const BranchEventView: FC<BranchEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  const data: Record<string, unknown> = {};
  if (event.from_span) {
    data["from_span"] = event.from_span;
  }
  if (event.from_message) {
    data["from_message"] = event.from_message;
  }

  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title={formatTitle("Branch", undefined, event.working_start)}
      className={className}
      subTitle={formatDateTime(new Date(event.timestamp))}
      icon={ApplicationIcons.info}
    >
      <MetaDataGrid entries={data} className={styles.panel} />
    </EventPanel>
  );
};
