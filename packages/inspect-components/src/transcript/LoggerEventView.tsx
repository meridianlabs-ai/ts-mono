import clsx from "clsx";
import { FC } from "react";

import type { LoggerEvent } from "@tsmono/inspect-common/types";
import {
  MetaDataGrid,
  RenderedContent,
} from "@tsmono/inspect-components/content";
import { ContentText } from "@tsmono/react/components";
import { parseJsonRecord } from "@tsmono/util";

import { useFormattedData } from "../content/DisplayModeContext";

import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import styles from "./LoggerEventView.module.css";
import { EventNode } from "./types";

interface LoggerEventViewProps {
  eventNode: EventNode<LoggerEvent>;
  className?: string;
}

export const LoggerEventView: FC<LoggerEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  const formatted = useFormattedData();
  const obj = formatted ? parseJsonRecord(event.message.message) : undefined;
  return (
    <EventRow
      eventNodeId={eventNode.id}
      className={className}
      title={event.message.level}
      icon={
        TranscriptIcons.logging[event.message.level.toLowerCase()] ||
        TranscriptIcons.info
      }
    >
      <div className={clsx("text-size-base", styles.grid)}>
        <div className={clsx("text-size-smaller")}>
          {obj ? (
            <MetaDataGrid entries={obj} />
          ) : (
            <RenderedContent
              id={eventNode.id}
              entry={{ name: "message", value: event.message.message }}
              renderOptions={{ renderString: "pre" }}
            />
          )}
        </div>
        <div className={clsx("text-size-smaller", "text-style-secondary")}>
          <ContentText text={event.message.filename} />:{event.message.lineno}
        </div>
      </div>
    </EventRow>
  );
};
