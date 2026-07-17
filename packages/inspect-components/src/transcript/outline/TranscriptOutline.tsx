import clsx from "clsx";
import {
  CSSProperties,
  FC,
  RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { useVirtuosoState } from "../../virtuoso/useVirtuosoState";
import { EventNode } from "../types";

import { OutlineLoadingRow, OutlineRow } from "./OutlineRow";
import styles from "./TranscriptOutline.module.css";
import { useOutlineNodes } from "./useOutlineNodes";
import { useOutlineScrollSync } from "./useOutlineScrollSync";
import { useOutlineWidth } from "./useOutlineWidth";

export const outlineNodeRunning = ({
  running,
  backfilling,
  isLast,
}: {
  running: boolean;
  backfilling: boolean;
  isLast: boolean;
}): boolean => running && !backfilling && isLast;

interface TranscriptOutlineProps {
  eventNodes: EventNode[];
  defaultCollapsedIds: Record<string, boolean>;
  running?: boolean;
  /** Whether the sample's event backlog is still loading (live sample). */
  backfilling?: boolean;
  className?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** The element that actually scrolls the outline (its own overflow
   *  container). Used as Virtuoso's scroll parent so virtualization tracks
   *  the outline's internal scroll rather than the shared main scroller. */
  outlineScrollEl?: HTMLDivElement | null;
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

// Sentinel appended as the final list item while backfilling so the loading
// affordance renders flush after the last outline row (a sibling would sit
// below Virtuoso's trailing padding node).
const OutlineLoadingNode: EventNode = { ...EventPaddingNode, id: "loading" };

export const TranscriptOutline: FC<TranscriptOutlineProps> = ({
  eventNodes,
  defaultCollapsedIds,
  running,
  backfilling,
  className,
  scrollRef,
  outlineScrollEl,
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

  const { outlineNodeList, allNodesList } = useOutlineNodes(
    eventNodes,
    collapsedEvents,
    defaultCollapsedIds
  );

  const { onOutlineSelect } = useOutlineScrollSync({
    allNodesList,
    outlineNodeList,
    scrollRef,
    scrollTrackOffset,
    setSelectedOutlineId,
  });

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
      } else if (node === OutlineLoadingNode) {
        return <OutlineLoadingRow key={node.id} />;
      } else {
        return (
          <OutlineRow
            node={node}
            key={node.id}
            running={outlineNodeRunning({
              running: running === true,
              backfilling: backfilling === true,
              isLast: index === outlineNodeList.length - 1,
            })}
            selected={
              selectedOutlineId ? selectedOutlineId === node.id : index === 0
            }
            getEventUrl={getEventUrl}
            onSelect={onOutlineSelect}
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
      backfilling,
      selectedOutlineId,
      getEventUrl,
      onOutlineSelect,
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
        customScrollParent={outlineScrollEl ?? undefined}
        id={id}
        data={
          backfilling
            ? [...outlineNodeList, OutlineLoadingNode, EventPaddingNode]
            : [...outlineNodeList, EventPaddingNode]
        }
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
