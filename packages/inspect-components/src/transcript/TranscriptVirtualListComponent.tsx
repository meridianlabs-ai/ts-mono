import clsx from "clsx";
import {
  CSSProperties,
  FC,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { VirtualList } from "@tsmono/react/virtual";
import type { VirtualListHandle } from "@tsmono/react/virtual";

import { GeneratingIndicator } from "../indicators/GeneratingIndicator";

import { EventLabelContext } from "./EventLabelContext";
import { eventSearchText } from "./eventText";
import { RenderedEventNode } from "./TranscriptVirtualList";
import styles from "./TranscriptVirtualListComponent.module.css";
import { EventNode, EventNodeContext, EventPanelCallbacks } from "./types";

interface TranscriptVirtualListComponentProps {
  id: string;
  listHandle: RefObject<VirtualListHandle | null>;
  eventNodes: EventNode[];
  initialEventId?: string | null;
  offsetTop?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  running?: boolean;
  className?: string;
  turnMap?: Map<string, { turnNumber: number; totalTurns: number }>;
  disableVirtualization?: boolean;
  onNativeFindChanged?: (nativeFind: boolean) => void;
  onAutoCollapse?: (eventId: string) => void;
  renderAgentCard?: (node: EventNode, className?: string) => ReactNode;
  eventCallbacks?: EventPanelCallbacks;
  /** Extra context fields merged into every EventNodeContext entry. */
  eventNodeContext?: Partial<EventNodeContext>;
  /** External ref filled with Virtuoso's current visible range, for find machinery. */
  visibleRangeRef?: RefObject<{ startIndex: number; endIndex: number }>;
}

/**
 * Renders the Transcript component.
 */
export const TranscriptVirtualListComponent: FC<
  TranscriptVirtualListComponentProps
> = ({
  id,
  listHandle,
  eventNodes,
  scrollRef,
  running,
  initialEventId,
  offsetTop,
  className,
  turnMap,
  disableVirtualization,
  onNativeFindChanged,
  onAutoCollapse,
  renderAgentCard,
  eventCallbacks,
  eventNodeContext,
  visibleRangeRef,
}) => {
  // Always virtualize when not explicitly disabled. The previous threshold
  // (`running || eventNodes.length > 100`) skipped virtualization for short
  // transcripts, which routed scroll-to-event through a plain-DOM
  // `scrollIntoView` fallback that didn't reliably scroll the actual scroll
  // container — making swimlane / outline navigation appear broken on small
  // event lists. Virtuoso handles short lists fine.
  const useVirtualization = !disableVirtualization;

  useEffect(() => {
    onNativeFindChanged?.(!useVirtualization);
  }, [onNativeFindChanged, useVirtualization]);

  // Mount-time anchor for Virtuoso's layout. Captured once and frozen —
  // runtime URL→event navigation is handled imperatively in
  // TranscriptViewNodes, so this state never updates after the first render.
  const [initialEventIndex] = useState<number | undefined>(() => {
    if (initialEventId === null || initialEventId === undefined)
      return undefined;
    const idx = eventNodes.findIndex((e) => e.id === initialEventId);
    return idx === -1 ? undefined : idx;
  });

  const hasToolEventsAtCurrentDepth = useCallback(
    (startIndex: number) => {
      const startNode = eventNodes[startIndex];
      if (!startNode) return false;
      // Walk backwards from this index to see if we see any tool events
      // at this depth, prior to this event
      for (let i = startIndex; i >= 0; i--) {
        const node = eventNodes[i];
        if (!node) return false;

        if (node.event.event === "tool") {
          return true;
        }
        if (node.depth < startNode.depth) {
          return false;
        }
      }
      return false;
    },
    [eventNodes]
  );

  // Non-virtual scroll-into-view for initial event
  const nonVirtualGridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!useVirtualization && initialEventId) {
      const row = nonVirtualGridRef.current?.querySelector(
        `[id="${initialEventId}"]`
      );
      row?.scrollIntoView({ block: "start" });
    }
  }, [initialEventId, useVirtualization]);

  // Pre-compute context objects for all event nodes to maintain stable references
  const contextMap = useMemo(() => {
    const map = new Map<string, EventNodeContext>();
    for (const [i, node] of eventNodes.entries()) {
      const hasToolEvents = hasToolEventsAtCurrentDepth(i);
      const turnInfo = turnMap?.get(node.id);
      map.set(node.id, { hasToolEvents, turnInfo, ...eventNodeContext });
    }
    return map;
  }, [eventNodes, hasToolEventsAtCurrentDepth, turnMap, eventNodeContext]);

  const eventLabels = eventNodeContext?.eventLabels;

  const renderRow = useCallback(
    (index: number, item: EventNode, style?: CSSProperties) => {
      const paddingClass = index === 0 ? styles.first : undefined;

      const previousIndex = index - 1;
      const nextIndex = index + 1;
      const previous =
        previousIndex >= 0 && previousIndex < eventNodes.length
          ? eventNodes[previousIndex]
          : undefined;
      const next =
        nextIndex < eventNodes.length ? eventNodes[nextIndex] : undefined;
      const attached =
        item.event.event === "tool" &&
        (previous?.event.event === "tool" || previous?.event.event === "model");

      const attachedParent =
        item.event.event === "model" && next?.event.event === "tool";
      const attachedClass = attached ? styles.attached : undefined;
      const attachedChildClass = attached ? styles.attachedChild : undefined;
      const attachedParentClass = attachedParent
        ? styles.attachedParent
        : undefined;
      const depthRootClass = item.depth === 0 ? styles.depthRoot : undefined;

      const context = contextMap.get(item.id);
      const isLast = index === eventNodes.length - 1;
      const renderedNode = (
        <EventLabelContext.Provider value={eventLabels?.[item.id]}>
          <RenderedEventNode
            node={item}
            next={next}
            className={clsx(
              attachedParentClass,
              attachedChildClass,
              depthRootClass
            )}
            context={context}
            onAutoCollapse={onAutoCollapse}
            renderAgentCard={renderAgentCard}
            eventCallbacks={eventCallbacks}
          />
        </EventLabelContext.Provider>
      );

      return (
        <div
          id={item.id}
          key={item.id}
          className={clsx(
            styles.node,
            paddingClass,
            isLast ? styles.last : undefined,
            attachedClass
          )}
          style={{
            ...style,
            paddingLeft: `${item.depth <= 1 ? item.depth * 0.7 : (0.7 + item.depth - 1) * 1}em`,
            paddingRight: `${item.depth === 0 ? undefined : ".7em"} `,
          }}
        >
          {renderedNode}
        </div>
      );
    },
    [
      eventNodes,
      contextMap,
      onAutoCollapse,
      renderAgentCard,
      eventCallbacks,
      eventLabels,
    ]
  );

  // Tools are executing when the latest model event requested tool calls that
  // don't yet all have a (completed) tool event. Pending tool events aren't
  // reliably streamed to the viewer, so we derive this from model events —
  // matching each tool_call to its tool event by id.
  const toolsRunning = useMemo(
    () => running === true && transcriptToolsRunning(eventNodes),
    [running, eventNodes]
  );
  const components = useMemo(() => ({ Footer: ToolRunningFooter }), []);

  if (useVirtualization) {
    return (
      <VirtualList<EventNode>
        ref={listHandle}
        className={className}
        persistenceKey={id}
        scrollRef={scrollRef}
        data={eventNodes}
        initialIndex={initialEventIndex}
        stickyHeaderOffset={offsetTop}
        renderRow={renderRow}
        live={running}
        smoothScroll={!!running}
        scrollToTopOnFinish={true}
        itemSearchText={eventSearchText}
        findScope="none"
        showProgress={toolsRunning}
        components={components}
        onVisibleRangeChange={(range) => {
          if (visibleRangeRef) visibleRangeRef.current = range;
        }}
      />
    );
  } else {
    return (
      <div ref={nonVirtualGridRef}>
        {eventNodes.map((node, index) => {
          const row = renderRow(index, node, {
            scrollMarginTop: offsetTop,
          });
          return row;
        })}
        {toolsRunning ? <ToolRunningFooter /> : null}
      </div>
    );
  }
};

const ToolRunningFooter: FC = () => (
  <div className={styles.runningTool}>
    <GeneratingIndicator label="running" />
  </div>
);

// True when the most recent model event requested tool calls that don't all
// have a completed tool event yet (i.e. a tool is still executing).
function transcriptToolsRunning(eventNodes: EventNode[]): boolean {
  let lastModelIdx = -1;
  for (let i = eventNodes.length - 1; i >= 0; i--) {
    if (eventNodes[i]?.event.event === "model") {
      lastModelIdx = i;
      break;
    }
  }
  if (lastModelIdx === -1) return false;
  const modelEvent = eventNodes[lastModelIdx]!.event;
  if (modelEvent.event !== "model" || modelEvent.pending) return false;
  const toolCalls = modelEvent.output.choices[0]?.message.tool_calls ?? [];
  if (toolCalls.length === 0) return false;
  const completedToolIds = new Set<string>();
  for (let i = lastModelIdx + 1; i < eventNodes.length; i++) {
    const ev = eventNodes[i]!.event;
    if (ev.event === "tool" && !ev.pending) completedToolIds.add(ev.id);
  }
  return toolCalls.some((call) => !completedToolIds.has(call.id));
}
