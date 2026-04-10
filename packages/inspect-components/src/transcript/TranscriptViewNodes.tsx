/**
 * Shared component that wraps TranscriptVirtualList with tree flattening,
 * collapse state, turn-map computation, keyboard navigation, and imperative
 * scroll-to-event/index. Apps provide collapse state via callback props.
 */

import clsx from "clsx";
import {
  CSSProperties,
  forwardRef,
  ReactNode,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { VirtuosoHandle } from "react-virtuoso";

import { StickyScrollProvider } from "@tsmono/react/components";
import { useListKeyboardNavigation } from "@tsmono/react/hooks";

import {
  computeTurnMap,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
} from "./outline/tree-visitors";
import { TranscriptVirtualList } from "./TranscriptVirtualList";
import { kSandboxSignalName } from "./transform/fixups";
import { flatTree } from "./transform/flatten";
import {
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
} from "./types";
import type { EventNode, EventPanelCallbacks, EventType } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface TranscriptViewNodesProps {
  id: string;
  eventNodes: EventNode[];
  defaultCollapsedIds: Record<string, boolean>;
  /** Whether events are still being streamed (enables auto-follow scroll). */
  running?: boolean;
  nodeFilter?: (node: EventNode<EventType>[]) => EventNode<EventType>[];
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  initialEventId?: string | null;
  offsetTop?: number;
  className?: string | string[];
  renderAgentCard?: (
    node: EventNode,
    className?: string | string[]
  ) => ReactNode;
  turnMap?: Map<string, { turnNumber: number; totalTurns: number }>;
  getEventUrl?: (eventId: string) => string | undefined;
  linkingEnabled?: boolean;

  // Collapse state callbacks (app provides via its store)
  collapsedEvents?: Record<string, Record<string, boolean> | undefined>;
  onCollapse?: (scope: string, nodeId: string, collapsed: boolean) => void;
}

export interface TranscriptViewNodesHandle {
  /** Scroll to an event by its ID. */
  scrollToEvent: (eventId: string) => void;
  /** Scroll to a flattened-list index. */
  scrollToIndex: (index: number) => void;
}

// =============================================================================
// Component
// =============================================================================

export const TranscriptViewNodes = forwardRef<
  TranscriptViewNodesHandle,
  TranscriptViewNodesProps
>(function TranscriptViewNodes(
  {
    id,
    eventNodes,
    defaultCollapsedIds,
    running,
    nodeFilter,
    scrollRef,
    initialEventId,
    offsetTop = 10,
    className,
    renderAgentCard,
    turnMap,
    getEventUrl,
    linkingEnabled,
    collapsedEvents,
    onCollapse: onCollapseCallback,
  },
  ref
) {
  const listHandle = useRef<VirtuosoHandle | null>(null);

  const onCollapse = useCallback(
    (nodeId: string, collapsed: boolean) => {
      onCollapseCallback?.(kTranscriptCollapseScope, nodeId, collapsed);
    },
    [onCollapseCallback]
  );

  const getCollapsed = useCallback(
    (nodeId: string) => {
      const scopeEvents = collapsedEvents?.[kTranscriptCollapseScope];
      return scopeEvents?.[nodeId] === true;
    },
    [collapsedEvents]
  );

  const eventCallbacks = useMemo<EventPanelCallbacks>(
    () => ({ onCollapse, getCollapsed, getEventUrl, linkingEnabled }),
    [onCollapse, getCollapsed, getEventUrl, linkingEnabled]
  );

  const filteredEventNodes = nodeFilter ? nodeFilter(eventNodes) : eventNodes;

  const flattenedNodes = useMemo(() => {
    return flatTree(
      filteredEventNodes,
      (collapsedEvents
        ? collapsedEvents[kTranscriptCollapseScope]
        : undefined) || defaultCollapsedIds
    );
  }, [filteredEventNodes, collapsedEvents, defaultCollapsedIds]);

  // Auto-compute turnMap when not provided by the parent
  const computedTurnMap = useMemo(() => {
    if (turnMap) return turnMap;
    const outlineFiltered = flatTree(
      filteredEventNodes,
      (collapsedEvents
        ? collapsedEvents[kTranscriptOutlineCollapseScope]
        : undefined) || defaultCollapsedIds,
      [
        removeNodeVisitor("logger"),
        removeNodeVisitor("info"),
        removeNodeVisitor("state"),
        removeNodeVisitor("store"),
        removeNodeVisitor("approval"),
        removeNodeVisitor("input"),
        removeNodeVisitor("sandbox"),
        removeStepSpanNameVisitor(kSandboxSignalName),
        noScorerChildren(),
      ]
    );
    return computeTurnMap(outlineFiltered, flattenedNodes);
  }, [
    turnMap,
    filteredEventNodes,
    collapsedEvents,
    defaultCollapsedIds,
    flattenedNodes,
  ]);

  const scrollToEvent = useCallback(
    (eventId: string) => {
      const idx = flattenedNodes.findIndex((e) => e.id === eventId);
      if (idx !== -1 && listHandle.current) {
        listHandle.current.scrollToIndex({
          index: idx,
          align: "start",
          behavior: "auto",
          offset: offsetTop ? -offsetTop : undefined,
        });
      } else {
        // Non-virtual fallback: find the DOM element and scroll it into view
        const el = scrollRef?.current?.querySelector(`[id="${eventId}"]`);
        el?.scrollIntoView({ block: "start", behavior: "auto" });
      }
    },
    [flattenedNodes, offsetTop, scrollRef]
  );

  const scrollToIndex = useCallback(
    (index: number) => {
      listHandle.current?.scrollToIndex({
        index,
        align: "start",
        behavior: "auto",
        offset: offsetTop ? -offsetTop : undefined,
      });
    },
    [offsetTop]
  );

  useImperativeHandle(ref, () => ({ scrollToEvent, scrollToIndex }), [
    scrollToEvent,
    scrollToIndex,
  ]);

  useListKeyboardNavigation({
    listHandle,
    scrollRef,
    itemCount: flattenedNodes.length,
  });

  return (
    <StickyScrollProvider value={scrollRef ?? null}>
      <div
        style={
          {
            "--inspect-event-panel-sticky-top": `${offsetTop}px`,
          } as CSSProperties
        }
      >
        <TranscriptVirtualList
          id={id}
          listHandle={listHandle}
          eventNodes={flattenedNodes}
          scrollRef={scrollRef}
          running={running}
          offsetTop={offsetTop}
          className={clsx(className)}
          initialEventId={initialEventId}
          renderAgentCard={renderAgentCard}
          turnMap={computedTurnMap}
          eventCallbacks={eventCallbacks}
        />
      </div>
    </StickyScrollProvider>
  );
});
