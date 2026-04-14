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
import type { EventNode, EventNodeContext, EventPanelCallbacks } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface TranscriptViewNodesProps {
  id: string;
  eventNodes: EventNode[];
  defaultCollapsedIds: Record<string, boolean>;
  /** Whether events are still being streamed (enables auto-follow scroll). */
  running?: boolean;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  initialEventId?: string | null;
  offsetTop?: number;
  className?: string;
  renderAgentCard?: (node: EventNode, className?: string) => ReactNode;
  turnMap?: Map<string, { turnNumber: number; totalTurns: number }>;
  getEventUrl?: (eventId: string) => string | undefined;
  linkingEnabled?: boolean;

  // Collapse state (app provides via its store, already scope-specific)
  collapsedTranscript?: Record<string, boolean>;
  /** Outline collapse state, used only for turn-map computation. */
  collapsedOutline?: Record<string, boolean>;
  onCollapseTranscript?: (nodeId: string, collapsed: boolean) => void;
  /** Extra context fields merged into every EventNodeContext entry. */
  eventNodeContext?: Partial<EventNodeContext>;
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
    scrollRef,
    initialEventId,
    offsetTop = 10,
    className,
    renderAgentCard,
    turnMap,
    getEventUrl,
    linkingEnabled,
    collapsedTranscript,
    collapsedOutline,
    onCollapseTranscript,
    eventNodeContext,
  },
  ref
) {
  const listHandle = useRef<VirtuosoHandle | null>(null);

  const getCollapsed = useCallback(
    (nodeId: string) => {
      return collapsedTranscript?.[nodeId] === true;
    },
    [collapsedTranscript]
  );

  const eventCallbacks = useMemo<EventPanelCallbacks>(
    () => ({
      onCollapse: onCollapseTranscript,
      getCollapsed,
      getEventUrl,
      linkingEnabled,
    }),
    [onCollapseTranscript, getCollapsed, getEventUrl, linkingEnabled]
  );

  const flattenedNodes = useMemo(() => {
    return flatTree(eventNodes, collapsedTranscript || defaultCollapsedIds);
  }, [eventNodes, collapsedTranscript, defaultCollapsedIds]);

  // Auto-compute turnMap when not provided by the parent
  const computedTurnMap = useMemo(() => {
    if (turnMap) return turnMap;
    const outlineFiltered = flatTree(
      eventNodes,
      collapsedOutline || defaultCollapsedIds,
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
    eventNodes,
    collapsedOutline,
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
          eventNodeContext={eventNodeContext}
        />
      </div>
    </StickyScrollProvider>
  );
});
