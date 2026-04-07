import { FC, memo, ReactNode, RefObject } from "react";
import { VirtuosoHandle } from "react-virtuoso";

import type {
  ApprovalEvent,
  BranchEvent,
  CompactionEvent,
  ErrorEvent,
  InfoEvent,
  InputEvent,
  LoggerEvent,
  ModelEvent,
  SampleInitEvent,
  SampleLimitEvent,
  SandboxEvent,
  ScoreEditEvent,
  ScoreEvent,
  SpanBeginEvent,
  StateEvent,
  StepEvent,
  StoreEvent,
  SubtaskEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { ApprovalEventView } from "./ApprovalEventView";
import { BranchEventView } from "./BranchEventView";
import { CompactionEventView } from "./CompactionEventView";
import { ErrorEventView } from "./ErrorEventView";
import { InfoEventView } from "./InfoEventView";
import { InputEventView } from "./InputEventView";
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
import { ToolEventView } from "./ToolEventView";
import { TranscriptVirtualListComponent } from "./TranscriptVirtualListComponent";
import { EventNode, EventNodeContext } from "./types";

interface TranscriptVirtualListProps {
  id: string;
  eventNodes: EventNode[];
  listHandle: RefObject<VirtuosoHandle | null>;
  initialEventId?: string | null;
  offsetTop?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  running?: boolean;
  className?: string | string[];
  turnMap?: Map<string, { turnNumber: number; totalTurns: number }>;
  disableVirtualization?: boolean;
  onNativeFindChanged?: (nativeFind: boolean) => void;
  onAutoCollapse?: (eventId: string) => void;
  /** Optional renderer for span_begin events that represent agents/branches. */
  renderAgentCard?: (
    node: EventNode,
    className?: string | string[]
  ) => ReactNode;
}

/**
 * Renders the Transcript Virtual List.
 */
const TranscriptVirtualListInner: FC<TranscriptVirtualListProps> = (props) => {
  return (
    <TranscriptVirtualListComponent
      id={props.id}
      listHandle={props.listHandle}
      eventNodes={props.eventNodes}
      initialEventId={props.initialEventId}
      offsetTop={props.offsetTop}
      scrollRef={props.scrollRef}
      running={props.running}
      className={props.className}
      turnMap={props.turnMap}
      disableVirtualization={props.disableVirtualization}
      onNativeFindChanged={props.onNativeFindChanged}
      onAutoCollapse={props.onAutoCollapse}
      renderAgentCard={props.renderAgentCard}
    />
  );
};
TranscriptVirtualListInner.displayName = "TranscriptVirtualList";

export const TranscriptVirtualList = memo(TranscriptVirtualListInner);

interface RenderedEventNodeProps {
  node: EventNode;
  next?: EventNode;
  className?: string | string[];
  context?: EventNodeContext;
  onAutoCollapse?: (eventId: string) => void;
  renderAgentCard?: (
    node: EventNode,
    className?: string | string[]
  ) => ReactNode;
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
}) => {
  switch (node.event.event) {
    case "sample_init":
      return (
        <SampleInitEventView
          eventNode={node as EventNode<SampleInitEvent>}
          className={className}
        />
      );

    case "sample_limit":
      return (
        <SampleLimitEventView
          eventNode={node as EventNode<SampleLimitEvent>}
          className={className}
        />
      );

    case "info":
      return (
        <InfoEventView
          eventNode={node as EventNode<InfoEvent>}
          className={className}
        />
      );

    case "branch":
      return (
        <BranchEventView
          eventNode={node as EventNode<BranchEvent>}
          className={className}
        />
      );

    case "compaction":
      return (
        <CompactionEventView
          eventNode={node as EventNode<CompactionEvent>}
          className={className}
        />
      );

    case "logger":
      return (
        <LoggerEventView
          eventNode={node as EventNode<LoggerEvent>}
          className={className}
        />
      );

    case "model":
      return (
        <ModelEventView
          eventNode={node as EventNode<ModelEvent>}
          showToolCalls={next?.event.event !== "tool"}
          className={className}
          context={context}
        />
      );

    case "score":
      return (
        <ScoreEventView
          eventNode={node as EventNode<ScoreEvent>}
          className={className}
        />
      );

    case "score_edit":
      return (
        <ScoreEditEventView
          eventNode={node as EventNode<ScoreEditEvent>}
          className={className}
        />
      );

    case "state":
      return (
        <StateEventView
          eventNode={node as EventNode<StateEvent>}
          className={className}
          onAutoCollapse={onAutoCollapse}
        />
      );

    case "span_begin": {
      // If the app provides a renderer for agent/branch spans, use it
      if (renderAgentCard && node.sourceSpan) {
        const spanType = node.sourceSpan.spanType;
        if (spanType === "agent" || spanType === "branch") {
          return <>{renderAgentCard(node, className)}</>;
        }
      }
      return (
        <SpanEventView
          eventNode={node as EventNode<SpanBeginEvent>}
          childNodes={node.children}
          className={className}
        />
      );
    }

    case "step":
      return (
        <StepEventView
          eventNode={node as EventNode<StepEvent>}
          childNodes={node.children}
          className={className}
        />
      );

    case "store":
      return (
        <StateEventView
          eventNode={node as EventNode<StoreEvent>}
          className={className}
          onAutoCollapse={onAutoCollapse}
        />
      );

    case "subtask":
      return (
        <SubtaskEventView
          eventNode={node as EventNode<SubtaskEvent>}
          className={className}
          childNodes={node.children}
        />
      );

    case "tool":
      return (
        <ToolEventView
          eventNode={node as EventNode<ToolEvent>}
          className={className}
          childNodes={node.children}
          context={context}
        />
      );

    case "input":
      return (
        <InputEventView
          eventNode={node as EventNode<InputEvent>}
          className={className}
        />
      );

    case "error":
      return (
        <ErrorEventView
          eventNode={node as EventNode<ErrorEvent>}
          className={className}
        />
      );

    case "approval":
      return (
        <ApprovalEventView
          eventNode={node as EventNode<ApprovalEvent>}
          className={className}
        />
      );

    case "sandbox":
      return (
        <SandboxEventView
          eventNode={node as EventNode<SandboxEvent>}
          className={className}
        />
      );

    default:
      return null;
  }
};
RenderedEventNodeInner.displayName = "RenderedEventNode";

export const RenderedEventNode = memo(RenderedEventNodeInner);
