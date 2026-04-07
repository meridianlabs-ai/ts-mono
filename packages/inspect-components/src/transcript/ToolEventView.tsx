import clsx from "clsx";
import { FC, useMemo } from "react";

import type {
  ApprovalEvent,
  ModelEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";
import {
  ChatView,
  resolveToolInput,
  substituteToolCallContent,
  ToolCallView,
} from "@tsmono/inspect-components/chat";
import { PulsingDots } from "@tsmono/react/components";

import { ApprovalEventView } from "./ApprovalEventView";
import { EventPanel } from "./event/EventPanel";
import { formatTiming, formatTitle } from "./event/utils";
import { TranscriptIcons } from "./icons";
import styles from "./ToolEventView.module.css";
import {
  EventNode,
  EventNodeContext,
  EventPanelCallbacks,
  EventType,
} from "./types";

interface ToolEventViewProps extends EventPanelCallbacks {
  eventNode: EventNode<ToolEvent>;
  childNodes: EventNode<EventType>[];
  className?: string | string[];
  context?: EventNodeContext;
}

export const ToolEventView: FC<ToolEventViewProps> = ({
  eventNode,
  childNodes,
  className,
  context,
  onCollapse,
  getCollapsed,
  getEventUrl,
  linkingEnabled,
}) => {
  const event = eventNode.event;

  // Extract tool input
  const { name, input, description, functionCall, contentType } = useMemo(
    () => resolveToolInput(event.function, event.arguments),
    [event.function, event.arguments]
  );

  // Resolve {{placeholder}} substitutions in tool call view content
  const resolvedView = useMemo(
    () =>
      event.view
        ? substituteToolCallContent(
            event.view,
            event.arguments as Record<string, unknown>
          )
        : undefined,
    [event.view, event.arguments]
  );

  const { approvalNode, lastModelNode } = useMemo(() => {
    const approval = childNodes.find((e) => {
      return e.event.event === "approval";
    });

    const lastModel = childNodes.findLast((e) => {
      return e.event.event === "model";
    });

    return {
      approvalNode: approval as EventNode<ApprovalEvent> | undefined,
      lastModelNode: lastModel as EventNode<ModelEvent> | undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.events]);

  const title = `Tool: ${resolvedView?.title || name}`;

  const turnLabel = context?.turnInfo
    ? `turn ${context.turnInfo.turnNumber}/${context.turnInfo.totalTurns}`
    : undefined;

  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title={formatTitle(title, undefined, event.working_time)}
      className={className}
      subTitle={
        event.timestamp
          ? formatTiming(event.timestamp, event.working_start)
          : undefined
      }
      icon={TranscriptIcons.solvers.use_tools}
      childIds={childNodes.map((child) => child.id)}
      collapseControl="bottom"
      turnLabel={turnLabel}
      onCollapse={onCollapse}
      getCollapsed={getCollapsed}
      getEventUrl={getEventUrl}
      linkingEnabled={linkingEnabled}
    >
      <div data-name="Summary" className={styles.summary}>
        <ToolCallView
          id={`${eventNode.id}-tool-call`}
          tool={name}
          functionCall={functionCall}
          input={input}
          description={description}
          contentType={contentType}
          output={event.error?.message || event.result || ""}
          mode="compact"
          view={resolvedView}
        />

        {lastModelNode ? (
          <ChatView
            id={`${eventNode.id}-toolcall-chatmessage`}
            messages={lastModelNode.event.output.choices.map((m) => m.message)}
            tools={{ callStyle: "compact" }}
          />
        ) : undefined}

        {approvalNode ? (
          <ApprovalEventView
            eventNode={approvalNode}
            className={styles.approval}
          />
        ) : (
          ""
        )}
        {event.pending ? (
          <div className={clsx(styles.progress)}>
            <PulsingDots subtle={false} size="medium" />
          </div>
        ) : undefined}
      </div>
    </EventPanel>
  );
};
