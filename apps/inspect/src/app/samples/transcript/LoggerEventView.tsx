import clsx from "clsx";
import { FC } from "react";

import { LoggerEvent } from "@tsmono/inspect-common/types";
import { parsedJson as maybeParseJson } from "@tsmono/util";

import ExpandablePanel from "../../../components/ExpandablePanel";
import { ApplicationIcons } from "../../appearance/icons";
import { MetaDataGrid } from "../../content/MetaDataGrid";

import { EventRow } from "./event/EventRow";
import { eventTitle } from "./event/utils";
import styles from "./LoggerEventView.module.css";
import { EventNode } from "./types";

interface LoggerEventViewProps {
  eventNode: EventNode<LoggerEvent>;
  className?: string | string[];
}

/**
 * Renders the LoggerEventView component.
 */
export const LoggerEventView: FC<LoggerEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  const obj = maybeParseJson(event.message.message);
  return (
    <EventRow
      className={className}
      title={eventTitle(event)}
      icon={ApplicationIcons.logging[event.message.level.toLowerCase()]}
    >
      <div className={clsx("text-size-base", styles.grid)}>
        <div className={clsx("text-size-smaller")}>
          {obj !== undefined && obj !== null ? (
            <MetaDataGrid entries={obj as Record<string, unknown>} />
          ) : (
            <ExpandablePanel
              id={`event-message-${event.uuid}`}
              collapse={true}
              className={clsx(styles.wrap)}
            >
              {event.message.message}
            </ExpandablePanel>
          )}
        </div>
        <div className={clsx("text-size-smaller", "text-style-secondary")}>
          {event.message.filename}:{event.message.lineno}
        </div>
      </div>
    </EventRow>
  );
};
