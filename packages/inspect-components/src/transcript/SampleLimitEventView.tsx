import clsx from "clsx";
import { FC } from "react";

import type { SampleLimitEvent } from "@tsmono/inspect-common/types";
import { IconName } from "@tsmono/react/icons";
import { formatDateTime } from "@tsmono/util";

import { EventPanel } from "./event/EventPanel";
import { EventNode } from "./types";

type SampleLimitType = SampleLimitEvent["type"];
interface SampleLimitEventViewProps {
  eventNode: EventNode<SampleLimitEvent>;
  className?: string;
}

export const SampleLimitEventView: FC<SampleLimitEventViewProps> = ({
  eventNode,
  className,
}) => {
  const resolve_title = (type: SampleLimitType): string => {
    switch (type) {
      case "custom":
        return "Custom Limit Exceeded";
      case "time":
        return "Time Limit Exceeded";
      case "message":
        return "Message Limit Exceeded";
      case "token":
        return "Token Limit Exceeded";
      case "turn":
        return "Turn Limit Exceeded";
      case "operator":
        return "Operator Cancelled";
      case "working":
        return "Execution Time Limit Exceeded";
      case "cost":
        return "Cost Limit Exceeded";
    }
  };

  const resolve_icon = (type: SampleLimitType): IconName => {
    switch (type) {
      case "custom":
        return "limitCustom";
      case "time":
        return "limitTime";
      case "message":
        return "limitMessages";
      case "token":
        return "limitTokens";
      case "turn":
        return "limitTurns";
      case "operator":
        return "limitOperator";
      case "working":
        return "limitExecution";
      case "cost":
        return "limitCost";
    }
  };

  const baseTitle = resolve_title(eventNode.event.type);
  const title = eventNode.event.timestamp
    ? `${baseTitle} — ${formatDateTime(new Date(eventNode.event.timestamp))}`
    : baseTitle;
  const icon = resolve_icon(eventNode.event.type);

  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title={title}
      icon={icon}
      className={className}
    >
      <div className={clsx("text-size-smaller")}>{eventNode.event.message}</div>
    </EventPanel>
  );
};
