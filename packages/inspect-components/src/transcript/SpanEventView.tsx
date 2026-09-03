import clsx from "clsx";
import { FC, useMemo } from "react";

import type { SpanBeginEvent, StepEvent } from "@tsmono/inspect-common/types";
import { formatDateTime } from "@tsmono/util";

import { EventPanel } from "./event/EventPanel";
import { kSandboxSignalName } from "./transform/fixups";
import { EventNode, EventPanelCallbacks, EventType } from "./types";

interface SpanEventViewProps {
  eventNode: EventNode<SpanBeginEvent | StepEvent>;
  childNodes: EventNode<EventType>[];
  className?: string;
  eventCallbacks?: EventPanelCallbacks;
}

/**
 * Grouping panel for a span_begin event or its legacy step equivalent,
 * summarizing the child events it contains.
 */
export const SpanEventView: FC<SpanEventViewProps> = ({
  eventNode,
  childNodes,
  className,
  eventCallbacks,
}) => {
  const event = eventNode.event;
  const title =
    displayName(event) ||
    `${event.type ? event.type + ": " : "Step: "}${event.name}`;

  const text = useMemo(() => summarize(childNodes), [childNodes]);
  const childIds = useMemo(
    () => childNodes.map((child) => child.id),
    [childNodes]
  );

  return (
    <EventPanel
      eventNodeId={eventNode.id}
      muted
      childIds={childIds}
      className={clsx("transcript-span", className)}
      title={title}
      subTitle={
        event.timestamp ? formatDateTime(new Date(event.timestamp)) : undefined
      }
      text={text}
      eventCallbacks={eventCallbacks}
    />
  );
};

/**
 * Friendly title for well-known spans/steps; undefined falls back to the
 * event's own type/name.
 */
const displayName = (event: SpanBeginEvent | StepEvent): string | undefined => {
  if (event.type === "solver" || event.type === "scorer") {
    return undefined;
  }
  // The sandbox fixup names both its span and legacy-step markers with the
  // signal (spans carry it in span_id too); name covers both shapes, as in
  // collapse.ts and OutlineRow.
  if (event.name === kSandboxSignalName) {
    return "Sandbox Events";
  }
  if (event.name === "init") {
    return "Init";
  }
  return undefined;
};

const summarize = (children: EventNode[]) => {
  if (children.length === 0) {
    return "(no events)";
  }

  const formatEvent = (event: string, count: number) => {
    if (count === 1) {
      return `${count} ${event} event`;
    } else {
      return `${count} ${event} events`;
    }
  };

  const typeCount: Record<string, number> = {};
  children.forEach((child) => {
    const currentCount = typeCount[child.event.event] || 0;
    typeCount[child.event.event] = currentCount + 1;
  });

  const numberOfTypes = Object.keys(typeCount).length;
  if (numberOfTypes < 3) {
    return Object.keys(typeCount)
      .map((key) => {
        return formatEvent(key, typeCount[key] || 0);
      })
      .join(", ");
  }

  if (children.length === 1) {
    return "1 event";
  } else {
    return `${children.length} events`;
  }
};
