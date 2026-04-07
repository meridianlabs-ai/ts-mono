import clsx from "clsx";
import {
  CSSProperties,
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
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
  },
  ref
) {
  const listHandle = useRef<VirtuosoHandle | null>(null);

  // The list of events that have been collapsed
  const collapsedEvents = useStore((state) => state.transcriptCollapsedEvents);

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
      }
    },
    [flattenedNodes, offsetTop]
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

  // Cmd/Ctrl+Arrow keyboard shortcuts to jump to top/bottom of the event list.
  // Uses a two-stage scroll for ArrowDown: first jump near the end so Virtuoso
  // measures those items, then scroll to the very last item after a short delay.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.key === "ArrowUp") {
          listHandle.current?.scrollToIndex({ index: 0, align: "center" });
          event.preventDefault();
        } else if (event.key === "ArrowDown") {
          listHandle.current?.scrollToIndex({
            index: Math.max(flattenedNodes.length - 5, 0),
            align: "center",
          });

          // Allow Virtuoso to measure the near-bottom items before
          // scrolling to the true last item.
          setTimeout(() => {
            listHandle.current?.scrollToIndex({
              index: flattenedNodes.length - 1,
              align: "end",
            });
          }, 250);
          event.preventDefault();
        }
      }
    };

    const scrollElement = scrollRef?.current;
    if (scrollElement) {
      scrollElement.addEventListener("keydown", handleKeyDown);
      if (!scrollElement.hasAttribute("tabIndex")) {
        scrollElement.setAttribute("tabIndex", "0");
      }

      return () => {
        scrollElement.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [scrollRef, flattenedNodes, listHandle]);

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
        />
      </div>
    </StickyScrollProvider>
  );
});
