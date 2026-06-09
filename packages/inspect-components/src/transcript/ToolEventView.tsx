import clsx from "clsx";
import { FC, useMemo } from "react";

import type { ModelEvent, ToolEvent } from "@tsmono/inspect-common/types";
import {
  ChatView,
  resolveToolInput,
  substituteToolCallContent,
  ToolCallErrorView,
  ToolCallView,
  type ChatViewLabelOptions,
} from "@tsmono/inspect-components/chat";

import { computeMaxLabelLength } from "../chat/labelLength";
import { MessageLabel } from "../chat/MessageLabel";
import { GeneratingIndicator } from "../indicators/GeneratingIndicator";

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

interface ToolEventViewProps {
  eventNode: EventNode<ToolEvent>;
  childNodes: EventNode<EventType>[];
  className?: string;
  context?: EventNodeContext;
  eventCallbacks?: EventPanelCallbacks;
}

export const ToolEventView: FC<ToolEventViewProps> = ({
  eventNode,
  childNodes,
  className,
  context,
  eventCallbacks,
}) => {
  const event = eventNode.event;

  // Extract tool input
  const { name, input, description, functionCall, contentType, title } =
    useMemo(
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

  const approvalNode = context?.toolApprovals?.get(event.id);

  const lastModelNode = useMemo(() => {
    const lastModel = childNodes.findLast((e) => {
      return e.event.event === "model";
    });
    return lastModel as EventNode<ModelEvent> | undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.events]);

  const displayName = resolvedView?.title || title || name;
  const panelTitle = displayName ? `Tool: ${displayName}` : "Tool";

  const turnLabel = context?.turnInfo
    ? `turn ${context.turnInfo.turnNumber}/${context.turnInfo.totalTurns}`
    : undefined;

  const toolLabels = useMemo<ChatViewLabelOptions>(() => {
    const messageLabels = context?.messageLabels;
    if (!messageLabels) return { show: false };

    const directLabel = event.message_id
      ? messageLabels[event.message_id]
      : undefined;
    const label = directLabel ?? context?.toolLabels?.[event.id];
    return { messageLabels: label ? { [event.id]: label } : {} };
  }, [context?.messageLabels, context?.toolLabels, event.id, event.message_id]);

  const maxLabelLength = useMemo(
    () => computeMaxLabelLength(context?.messageLabels),
    [context?.messageLabels]
  );

  const showError = !!event.error && event.error.type !== "approval";
  const showResult = !showError && hasResultContent(event.result);

  // Render the call and its output as one attached pair (blue call box with the
  // gray output box seamlessly beneath it), mirroring the messages view. The
  // colors/flatten come from the shared [data-message-kind] rules in the theme.
  const toolCallView = (
    <div className={styles.attachedGroup}>
      <div
        data-message-kind="tool"
        className={clsx(
          styles.toolBox,
          showError || showResult ? styles.attachedBottom : undefined
        )}
      >
        <ToolCallView
          id={`${eventNode.id}-tool-call`}
          tool={name}
          functionCall={functionCall}
          input={input}
          description={description}
          contentType={contentType}
          output=""
          mode="compact"
          view={resolvedView}
          section="call"
        />
      </div>
      {showError ? (
        <div
          data-message-kind="tool-result"
          className={clsx(styles.toolBox, styles.attachedTop)}
        >
          <ToolCallErrorView error={event.error!} />
        </div>
      ) : showResult ? (
        <div
          data-message-kind="tool-result"
          className={clsx(styles.toolBox, styles.attachedTop)}
        >
          <ToolCallView
            id={`${eventNode.id}-tool-call`}
            tool={name}
            functionCall={functionCall}
            input={input}
            description={description}
            contentType={contentType}
            output={event.result || ""}
            mode="compact"
            view={resolvedView}
            section="output"
          />
        </div>
      ) : null}
    </div>
  );

  const toolLabel = toolLabels.messageLabels?.[event.id];

  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title={formatTitle(panelTitle, undefined, event.working_time)}
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
      eventCallbacks={eventCallbacks}
    >
      <div data-name="Summary" className={styles.summary}>
        {toolLabels.show === false ? (
          toolCallView
        ) : (
          <div className={styles.labeledToolCall}>
            <div className={styles.labeledToolContent}>{toolCallView}</div>
            <div
              className={styles.label}
              style={{ minWidth: `${maxLabelLength}ch` }}
            >
              {toolLabel ? <MessageLabel label={toolLabel} /> : null}
            </div>
          </div>
        )}

        {lastModelNode ? (
          <ChatView
            id={`${eventNode.id}-toolcall-chatmessage`}
            messages={lastModelNode.event.output.choices.map((m) => m.message)}
            tools={{ callStyle: "compact" }}
          />
        ) : undefined}

        {approvalNode ? (
          <div className={styles.approvalWrap}>
            <ApprovalEventView
              eventNode={approvalNode}
              className={styles.approval}
            />
          </div>
        ) : (
          ""
        )}
        {event.pending ? (
          <div className={clsx(styles.progress)}>
            <GeneratingIndicator label="running" />
          </div>
        ) : undefined}
      </div>
    </EventPanel>
  );
};

// Whether a tool event has output worth rendering in its own result box.
function hasResultContent(result: ToolEvent["result"]): boolean {
  if (result === null || result === undefined) return false;
  if (typeof result === "string") return result.trim().length > 0;
  if (Array.isArray(result)) return result.length > 0;
  return true;
}
