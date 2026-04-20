import clsx from "clsx";
import {
  CSSProperties,
  FC,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { useScrollTrack, useVirtuosoState } from "@tsmono/react/hooks";

import { kSandboxSignalName } from "../transform/fixups";
import { flatTree } from "../transform/flatten";
import { EventNode } from "../types";

import { OutlineRow } from "./OutlineRow";
import styles from "./TranscriptOutline.module.css";
import {
  collapseScoring,
  collapseTurns,
  makeTurns,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
} from "./tree-visitors";
import { useOutlineWidth } from "./useOutlineWidth";

const kFramesToStabilize = 10;

interface TranscriptOutlineProps {
  eventNodes: EventNode[];
  defaultCollapsedIds: Record<string, boolean>;
  running?: boolean;
  className?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  style?: CSSProperties;
  /** Name of the agent/subagent currently being displayed. Shown as a static header. */
  agentName?: string;
  /** Reports whether the outline has displayable nodes after filtering. */
  onHasNodesChange?: (hasNodes: boolean) => void;
  /** Reports the ideal width (in px) for the outline column. */
  onWidthChange?: (width: number) => void;
  /** Called when user clicks an outline item but URL-based navigation is unavailable. */
  onNavigateToEvent?: (eventId: string) => void;
  /** Offset from the top of the scroll container where visible content begins. */
  scrollTrackOffset?: number;

  // --- Callback props replacing store hooks ---
  /** URL generator for deep linking to events. */
  getEventUrl?: (eventId: string) => string | undefined;
  /** Get collapsed state for an outline node. */
  getCollapsed?: (id: string) => boolean;
  /** Set collapsed state for an outline node. */
  setCollapsed?: (id: string, collapsed: boolean) => void;
  /** Current collapsed events for the outline scope. */
  collapsedEvents?: Record<string, boolean>;
  /** Set multiple collapsed events at once (for initialization). */
  setCollapsedEvents?: (collapsed: Record<string, boolean>) => void;
  /** Currently selected outline node ID. */
  selectedOutlineId?: string | null;
  /** Set the selected outline node ID. */
  setSelectedOutlineId?: (id: string) => void;
  /** Optional custom link renderer for deep linking (replaces react-router Link). */
  renderLink?: (url: string, children: React.ReactNode) => React.ReactNode;
}

// Padding node at the end of the list for breathing room
const EventPaddingNode: EventNode = {
  id: "padding",
  event: {
    event: "info",
    source: "",
    data: "",
    timestamp: "",
    pending: false,
    working_start: 0,
    span_id: null,
    uuid: null,
    metadata: null,
  },
  depth: 0,
  children: [],
};

export const TranscriptOutline: FC<TranscriptOutlineProps> = ({
  eventNodes,
  defaultCollapsedIds,
  running,
  className,
  scrollRef,
  style,
  agentName,
  onHasNodesChange,
  onWidthChange,
  onNavigateToEvent,
  scrollTrackOffset,
  getEventUrl,
  getCollapsed,
  setCollapsed,
  collapsedEvents,
  setCollapsedEvents,
  selectedOutlineId,
  setSelectedOutlineId,
  renderLink,
}) => {
  const id = "transcript-tree";
  const listHandle = useRef<VirtuosoHandle | null>(null);
  const { getRestoreState } = useVirtuosoState(listHandle, id);

  // Flag to indicate programmatic scrolling is in progress.
  const isProgrammaticScrolling = useRef(false);
  const lastScrollPosition = useRef<number | null>(null);
  const stableFrameCount = useRef(0);

  const beginProgrammaticScroll = useCallback(() => {
    isProgrammaticScrolling.current = true;
    lastScrollPosition.current = null;
    stableFrameCount.current = 0;

    const checkScrollStabilized = () => {
      if (!isProgrammaticScrolling.current) return;

      const currentPosition = scrollRef?.current?.scrollTop ?? null;

      if (currentPosition === lastScrollPosition.current) {
        stableFrameCount.current++;
        if (stableFrameCount.current >= kFramesToStabilize) {
          isProgrammaticScrolling.current = false;
          return;
        }
      } else {
        stableFrameCount.current = 0;
        lastScrollPosition.current = currentPosition;
      }

      requestAnimationFrame(checkScrollStabilized);
    };

    requestAnimationFrame(checkScrollStabilized);
  }, [scrollRef]);

  const handleOutlineSelect = useCallback(
    (nodeId: string) => {
      setSelectedOutlineId?.(nodeId);
      beginProgrammaticScroll();
    },
    [setSelectedOutlineId, beginProgrammaticScroll]
  );

  const outlineNodeList = useMemo(() => {
    const nodeList = flatTree(
      eventNodes,
      (collapsedEvents ? collapsedEvents : undefined) || defaultCollapsedIds,
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

    return collapseScoring(collapseTurns(makeTurns(nodeList)));
  }, [eventNodes, collapsedEvents, defaultCollapsedIds]);

  const hasOutlineNodes = outlineNodeList.length > 0;
  useEffect(() => {
    onHasNodesChange?.(hasOutlineNodes);
  }, [hasOutlineNodes, onHasNodesChange]);

  // Measure the ideal width for the outline column from label text
  const outlineWidth = useOutlineWidth(outlineNodeList, undefined, agentName);
  useEffect(() => {
    onWidthChange?.(outlineWidth);
  }, [outlineWidth, onWidthChange]);

  // Set --outline-width on the nearest grid ancestor so the column resizes
  // automatically without each app needing to wire up the CSS variable.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let ancestor: HTMLElement | null = el.parentElement;
    while (ancestor) {
      if (getComputedStyle(ancestor).display === "grid") {
        ancestor.style.setProperty("--outline-width", `${outlineWidth}px`);
        return;
      }
      ancestor = ancestor.parentElement;
    }
  }, [outlineWidth]);

  // All event nodes for scroll tracking
  const allNodesList = useMemo(() => {
    return flatTree(eventNodes, null);
  }, [eventNodes]);

  const elementIds = allNodesList.map((node) => node.id);
  const findNearestOutlineAbove = useCallback(
    (targetId: string): EventNode | null => {
      const targetIndex = allNodesList.findIndex(
        (node) => node.id === targetId
      );
      if (targetIndex === -1) return null;

      const outlineIds = new Set(outlineNodeList.map((node) => node.id));

      for (let i = targetIndex; i >= 0; i--) {
        const node = allNodesList[i];
        if (node !== undefined && node.id) {
          if (outlineIds.has(node.id)) {
            return node;
          }
        }
      }

      return null;
    },
    [allNodesList, outlineNodeList]
  );

  useScrollTrack(
    elementIds,
    (scrolledId: string) => {
      if (!isProgrammaticScrolling.current) {
        const parentNode = findNearestOutlineAbove(scrolledId);
        if (parentNode) {
          setSelectedOutlineId?.(parentNode.id);
        }
      }
    },
    scrollRef,
    { topOffset: scrollTrackOffset }
  );

  // Initialize collapsed events from defaults
  useEffect(() => {
    if (!collapsedEvents && Object.keys(defaultCollapsedIds).length > 0) {
      setCollapsedEvents?.(defaultCollapsedIds);
    }
  }, [defaultCollapsedIds, collapsedEvents, setCollapsedEvents]);

  const renderRow = useCallback(
    (index: number, node: EventNode) => {
      if (node === EventPaddingNode) {
        return (
          <div
            className={clsx(styles.eventPadding)}
            key={node.id}
            style={{ height: "2em" }}
          ></div>
        );
      } else {
        return (
          <OutlineRow
            node={node}
            key={node.id}
            running={running && index === outlineNodeList.length - 1}
            selected={
              selectedOutlineId ? selectedOutlineId === node.id : index === 0
            }
            getEventUrl={getEventUrl}
            onSelect={handleOutlineSelect}
            onNavigateToEvent={onNavigateToEvent}
            getCollapsed={getCollapsed}
            setCollapsed={setCollapsed}
            renderLink={renderLink}
          />
        );
      }
    },
    [
      outlineNodeList,
      running,
      selectedOutlineId,
      getEventUrl,
      handleOutlineSelect,
      onNavigateToEvent,
      getCollapsed,
      setCollapsed,
      renderLink,
    ]
  );

  return (
    <div ref={rootRef} style={style}>
      {agentName && (
        <div
          className={clsx(
            styles.rootHeader,
            "text-size-smaller",
            "text-style-secondary"
          )}
        >
          {agentName}
        </div>
      )}
      <Virtuoso
        ref={listHandle}
        // eslint-disable-next-line react-hooks/refs -- Virtuoso accepts undefined for customScrollParent
        customScrollParent={scrollRef?.current ? scrollRef.current : undefined}
        id={id}
        data={[...outlineNodeList, EventPaddingNode]}
        defaultItemHeight={50}
        itemContent={renderRow}
        atBottomThreshold={30}
        increaseViewportBy={{ top: 300, bottom: 300 }}
        overscan={{
          main: 10,
          reverse: 10,
        }}
        className={clsx(className, "transcript-outline")}
        skipAnimationFrameInResizeObserver={true}
        restoreStateFrom={getRestoreState()}
        tabIndex={0}
      />
    </div>
  );
};
