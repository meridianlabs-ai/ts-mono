import clsx from "clsx";
import { FC, useMemo } from "react";

import type { ToolEvent } from "@tsmono/inspect-common/types";
import {
  ChatView,
  ClientToolCall,
  resolveToolInput,
  substituteToolCallContent,
  ToolBlockInset,
  type ChatViewLabelOptions,
} from "@tsmono/inspect-components/chat";
import { getOwn } from "@tsmono/util";

import { computeMaxLabelLength } from "../chat/labelLength";
import { MessageLabel } from "../chat/MessageLabel";
import { GeneratingIndicator } from "../indicators/GeneratingIndicator";

import { ApprovalInset } from "./ApprovalEventView";
import { EventPanel } from "./event/EventPanel";
import { formatTiming, formatTitle } from "./event/utils";
import { TranscriptIcons } from "./icons";
import { SentinelInset } from "./SentinelEventView";
import { NotRunWell } from "./ToolCheckInset";
import styles from "./ToolEventView.module.css";
import {
  EventNode,
  EventNodeContext,
  eventNodeOf,
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

  const approvals = context?.toolApprovals?.get(event.id);
  const sentinels = context?.toolSentinels?.get(event.id);
  const finalApproval = approvals?.at(-1)?.event;
  const before = sentinels?.before;
  const blocker =
    finalApproval &&
    (finalApproval.decision === "reject" ||
      finalApproval.decision === "terminate")
      ? {
          decision: finalApproval.decision,
          explanation: finalApproval.explanation,
        }
      : before?.effective &&
          (before.verdict === "reject" || before.verdict === "terminate")
        ? {
            decision: before.verdict,
            explanation: before.effective.event.explanation,
          }
        : undefined;
  const modified =
    finalApproval?.decision === "modify" ||
    (before?.verdict === "modify" && !!before.effective);
  const beforeInsets =
    approvals || before ? (
      <ToolBlockInset region="input">
        {approvals ? <ApprovalInset chain={approvals} /> : null}
        {before ? (
          <SentinelInset step={before} region="input" context={context} />
        ) : null}
      </ToolBlockInset>
    ) : undefined;
  const afterInset = sentinels?.after ? (
    <ToolBlockInset region="output">
      <SentinelInset step={sentinels.after} region="output" context={context} />
    </ToolBlockInset>
  ) : undefined;
  // The model received the ToolApprovalError text; prefer the recorded one.
  const notRun = blocker ? (
    <NotRunWell
      message={
        event.error?.type === "approval"
          ? event.error.message
          : blocker.decision === "reject"
            ? blocker.explanation?.trim() || "Tool call not approved."
            : undefined
      }
    />
  ) : undefined;

  const lastModelNode = useMemo(() => {
    const lastModel = childNodes.findLast((e) => e.event.event === "model");
    return lastModel ? eventNodeOf(lastModel, "model") : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.events]);

  const displayName = resolvedView?.title || title || name;
  const panelTitle = displayName ? `Tool: ${displayName}` : "Tool";

  // Full turn-nav cluster, not just a passive label: tool headers are what is
  // stuck for most scroll positions of tool-heavy transcripts, so turn
  // navigation must stay reachable there too (self-relative to this turn).
  const turnNav = context?.turnInfo
    ? {
        turnNumber: context.turnInfo.turnNumber,
        totalTurns: context.turnInfo.totalTurns,
        isAnchor: context.turnIsAnchor ?? true,
      }
    : undefined;

  const toolLabels = useMemo<ChatViewLabelOptions>(() => {
    const messageLabels = context?.messageLabels;
    const toolLabelMap = context?.toolLabels;
    if (!messageLabels) return { show: false };

    const directLabel = event.message_id
      ? getOwn(messageLabels, event.message_id)
      : undefined;
    const label = directLabel ?? getOwn(toolLabelMap, event.id);
    return { messageLabels: label ? { [event.id]: label } : {} };
  }, [context?.messageLabels, context?.toolLabels, event.id, event.message_id]);

  const maxLabelLength = useMemo(
    () => computeMaxLabelLength(context?.messageLabels),
    [context?.messageLabels]
  );

  const showError = !!event.error && event.error.type !== "approval";

  // The shared tool block grammar: collapsible header with the input zone and
  // output well stacked beneath.
  const toolCallView = (
    <ClientToolCall
      id={`${eventNode.id}-tool-call`}
      tool={name}
      title={displayName}
      functionCall={functionCall}
      input={input}
      description={description}
      contentType={contentType}
      output={event.result}
      selfAnnotation={context?.selfAnnotation}
      inputScreenshot={context?.inputScreenshot}
      error={showError && event.error ? event.error : undefined}
      view={resolvedView}
      afterInput={beforeInsets}
      afterOutput={afterInset}
      inputStruck={modified}
      outputReplacement={notRun}
    />
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
      turnNav={turnNav}
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

        {event.pending ? (
          <div className={clsx(styles.progress)}>
            <GeneratingIndicator label="running" />
          </div>
        ) : undefined}
      </div>
    </EventPanel>
  );
};
