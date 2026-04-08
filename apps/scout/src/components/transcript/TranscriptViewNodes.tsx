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

import {
  computeTurnMap,
  flatTree,
  kSandboxSignalName,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
  TranscriptVirtualList,
} from "@tsmono/inspect-components/transcript";
import type {
  EventNode,
  EventType,
} from "@tsmono/inspect-components/transcript";
import { StickyScrollProvider } from "@tsmono/react/components";
import { useListKeyboardNavigation } from "@tsmono/react/hooks";

import { useStore } from "../../state/store";

import styles from "./TranscriptViewNodes.module.css";

interface TranscriptViewNodesProps {
  id: string;
  eventNodes: EventNode[];
  defaultCollapsedIds: Record<string, boolean>;
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
}

export interface TranscriptViewNodesHandle {
  /** Scroll to an event by its ID. */
  scrollToEvent: (eventId: string) => void;
  /** Scroll to a flattened-list index. */
  scrollToIndex: (index: number) => void;
}

export const TranscriptViewNodes = forwardRef<
  TranscriptViewNodesHandle,
  TranscriptViewNodesProps
>(function TranscriptViewNodes(
  {
    id,
    eventNodes,
    defaultCollapsedIds,
    nodeFilter,
    scrollRef,
    initialEventId,
    offsetTop = 10,
    className,
    renderAgentCard,
    turnMap,
    getEventUrl,
    linkingEnabled,
  },
  ref
) {
  const listHandle = useRef<VirtuosoHandle | null>(null);

  // The list of events that have been collapsed
  const collapsedEvents = useStore((state) => state.transcriptCollapsedEvents);
  const setTranscriptCollapsedEvent = useStore(
    (state) => state.setTranscriptCollapsedEvent
  );

  const onCollapse = useCallback(
    (nodeId: string, collapsed: boolean) => {
      setTranscriptCollapsedEvent(kTranscriptCollapseScope, nodeId, collapsed);
    },
    [setTranscriptCollapsedEvent]
  );

  const getCollapsed = useCallback(
    (nodeId: string) => {
      const scopeEvents = collapsedEvents?.[kTranscriptCollapseScope] as
        | Record<string, boolean>
        | undefined;
      return scopeEvents?.[nodeId] === true;
    },
    [collapsedEvents]
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
        ? (collapsedEvents[kTranscriptOutlineCollapseScope] as
            | Record<string, boolean>
            | undefined)
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
          offsetTop={offsetTop}
          className={clsx(styles.listContainer, className)}
          initialEventId={initialEventId}
          renderAgentCard={renderAgentCard}
          turnMap={computedTurnMap}
          onCollapse={onCollapse}
          getCollapsed={getCollapsed}
          getEventUrl={getEventUrl}
          linkingEnabled={linkingEnabled}
        />
      </div>
    </StickyScrollProvider>
  );
});
