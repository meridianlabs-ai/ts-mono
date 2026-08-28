import { FC, memo, ReactNode } from "react";

import { isRecord } from "@tsmono/util";

import { AnchorEventView } from "./AnchorEventView";
import { ApprovalEventView } from "./ApprovalEventView";
import { BranchEventView } from "./BranchEventView";
import {
  BranchPoint,
  findRowKeyForLabel,
  forkNavToBranchPointProps,
} from "./BranchPoint";
import { CheckpointEventView } from "./CheckpointEventView";
import { CompactionEventView } from "./CompactionEventView";
import { EmptyBranchView } from "./EmptyBranchView";
import { ErrorEventView } from "./ErrorEventView";
import { InfoEventView } from "./InfoEventView";
import { InputEventView } from "./InputEventView";
import { InterruptEventView } from "./InterruptEventView";
import { LoggerEventView } from "./LoggerEventView";
import { ModelEventView } from "./ModelEventView";
import { SampleInitEventView } from "./SampleInitEventView";
import { SampleLimitEventView } from "./SampleLimitEventView";
import { SandboxEventView } from "./SandboxEventView";
import { ScoreEditEventView } from "./ScoreEditEventView";
import { ScoreEventView } from "./ScoreEventView";
import { SpanEventView } from "./SpanEventView";
import { StateEventView } from "./state/StateEventView";
import { StepEventView } from "./StepEventView";
import { SubtaskEventView } from "./SubtaskEventView";
import { isForkNavData } from "./timeline/timelineEventNodes";
import { useTimelineRowSelect } from "./TimelineSelectContext";
import { ToolEventView } from "./ToolEventView";
import {
  EventNode,
  EventNodeContext,
  eventNodeOf,
  EventPanelCallbacks,
} from "./types";

export { TranscriptVirtualList } from "./TranscriptVirtualListComponent";

interface RenderedEventNodeProps {
  node: EventNode;
  next?: EventNode;
  className?: string;
  context?: EventNodeContext;
  onAutoCollapse?: (eventId: string) => void;
  renderAgentCard?: (node: EventNode, className?: string) => ReactNode;
  eventCallbacks?: EventPanelCallbacks;
}

/**
 * Renders the event based on its type.
 */
const RenderedEventNodeInner: FC<RenderedEventNodeProps> = ({
  node,
  next,
  className,
  context,
  onAutoCollapse,
  renderAgentCard,
  eventCallbacks,
}) => {
  const selectRow = useTimelineRowSelect();
  switch (node.event.event) {
    case "sample_init":
      return (
        <SampleInitEventView
          eventNode={eventNodeOf(node, "sample_init")}
          className={className}
        />
      );

    case "sample_limit":
      return (
        <SampleLimitEventView
          eventNode={eventNodeOf(node, "sample_limit")}
          className={className}
        />
      );

    case "info":
      return (
        <InfoEventView
          eventNode={eventNodeOf(node, "info")}
          className={className}
        />
      );

    case "branch":
      return (
        <BranchEventView
          eventNode={eventNodeOf(node, "branch")}
          className={className}
        />
      );

    case "anchor":
      return (
        <AnchorEventView
          eventNode={eventNodeOf(node, "anchor")}
          className={className}
        />
      );

    case "compaction":
      return (
        <CompactionEventView
          eventNode={eventNodeOf(node, "compaction")}
          className={className}
        />
      );

    case "logger":
      return (
        <LoggerEventView
          eventNode={eventNodeOf(node, "logger")}
          className={className}
        />
      );

    case "model":
      return (
        <ModelEventView
          eventNode={eventNodeOf(node, "model")}
          showToolCalls={next?.event.event !== "tool"}
          className={className}
          context={context}
          eventCallbacks={eventCallbacks}
        />
      );

    case "score":
      return (
        <ScoreEventView
          eventNode={eventNodeOf(node, "score")}
          className={className}
        />
      );

    case "score_edit":
      return (
        <ScoreEditEventView
          eventNode={eventNodeOf(node, "score_edit")}
          className={className}
        />
      );

    case "state":
      return (
        <StateEventView
          eventNode={eventNodeOf(node, "state")}
          className={className}
          onAutoCollapse={onAutoCollapse}
          eventCallbacks={eventCallbacks}
        />
      );

    case "span_begin": {
      if (node.event.type === "fork_nav") {
        const metadata: unknown = node.event.metadata;
        const data = isRecord(metadata) ? metadata["fork_nav"] : undefined;
        if (!isForkNavData(data)) return null;
        const props = forkNavToBranchPointProps(data);
        if (!props) return null;
        return (
          <BranchPoint
            {...props}
            className={className}
            onSelect={(label, anchorEl) => {
              const rowKey = findRowKeyForLabel(data, label);
              if (rowKey) selectRow?.(rowKey, anchorEl);
            }}
          />
        );
      }
      if (node.event.type === "empty_branch") {
        return (
          <EmptyBranchView
            eventNode={eventNodeOf(node, "span_begin")}
            className={className}
          />
        );
      }
      // If the app provides a renderer for agent/branch spans, use it
      if (renderAgentCard && node.sourceSpan) {
        const spanType = node.sourceSpan.spanType;
        if (spanType === "agent" || spanType === "branch") {
          return <>{renderAgentCard(node, className)}</>;
        }
      }
      return (
        <SpanEventView
          eventNode={eventNodeOf(node, "span_begin")}
          childNodes={node.children}
          className={className}
          eventCallbacks={eventCallbacks}
        />
      );
    }

    case "step":
      return (
        <StepEventView
          eventNode={eventNodeOf(node, "step")}
          childNodes={node.children}
          className={className}
          eventCallbacks={eventCallbacks}
        />
      );

    case "store":
      return (
        <StateEventView
          eventNode={eventNodeOf(node, "store")}
          className={className}
          onAutoCollapse={onAutoCollapse}
          eventCallbacks={eventCallbacks}
        />
      );

    case "subtask":
      return (
        <SubtaskEventView
          eventNode={eventNodeOf(node, "subtask")}
          className={className}
          childNodes={node.children}
          eventCallbacks={eventCallbacks}
        />
      );

    case "tool":
      return (
        <ToolEventView
          eventNode={eventNodeOf(node, "tool")}
          className={className}
          childNodes={node.children}
          context={context}
          eventCallbacks={eventCallbacks}
        />
      );

    case "input":
      return (
        <InputEventView
          eventNode={eventNodeOf(node, "input")}
          className={className}
        />
      );

    case "interrupt":
      return (
        <InterruptEventView
          eventNode={eventNodeOf(node, "interrupt")}
          className={className}
        />
      );

    case "error":
      return (
        <ErrorEventView
          eventNode={eventNodeOf(node, "error")}
          className={className}
        />
      );

    case "approval":
      return (
        <ApprovalEventView
          eventNode={eventNodeOf(node, "approval")}
          className={className}
        />
      );

    case "sandbox":
      return (
        <SandboxEventView
          eventNode={eventNodeOf(node, "sandbox")}
          className={className}
        />
      );

    case "checkpoint":
      return (
        <CheckpointEventView
          eventNode={eventNodeOf(node, "checkpoint")}
          className={className}
          eventCallbacks={eventCallbacks}
        />
      );

    default:
      return null;
  }
};
RenderedEventNodeInner.displayName = "RenderedEventNode";

export const RenderedEventNode = memo(RenderedEventNodeInner);
