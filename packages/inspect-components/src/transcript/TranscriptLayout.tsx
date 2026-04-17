/**
 * Shared layout component for transcript views.
 *
 * Encapsulates the full visual structure: timeline swimlanes, transcript
 * outline, and virtualized event list. Apps provide events, selection
 * state adapters, and store-backed collapse callbacks.
 *
 * General behaviors that both apps benefit from:
 * - Message ID → event resolution (citation navigation)
 * - Bulk collapse/expand of all collapsible events
 * - Outline auto-hide when no displayable nodes exist
 * - Branch scroll target handling
 * - Empty state display
 */

import clsx from "clsx";
import {
  CSSProperties,
  FC,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  Event,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";
import { NoContentsPanel, StickyScroll } from "@tsmono/react/components";
import { useScrubberProgress } from "@tsmono/react/hooks";

import { useListPositionManager } from "./hooks/useListPositionManager";
import { useStickySwimLaneHeight } from "./hooks/useStickySwimLaneHeight";
import { TranscriptOutline } from "./outline/TranscriptOutline";
import { resolveMessageToEvent } from "./resolveMessageToEvent";
import { AgentCardView, TimelineSwimLanes } from "./timeline/components";
import { type TimelineSpan } from "./timeline/core";
import {
  useEventNodes,
  useTimelineConfig,
  useTranscriptTimeline,
  type TimelineOptions,
  type UseActiveTimelineProps,
  type UseTimelineProps,
} from "./timeline/hooks";
import { type MarkerConfig } from "./timeline/markers";
import {
  buildSpanSelectKeys,
  getSelectedSpans,
} from "./timeline/timelineEventNodes";
import { TimelineSelectContext } from "./TimelineSelectContext";
import styles from "./TranscriptLayout.module.css";
import {
  TranscriptViewNodes,
  type TranscriptViewNodesHandle,
} from "./TranscriptViewNodes";
import {
  EventNode,
  kCollapsibleEventTypes,
  type EventNodeContext,
  type TranscriptCollapseState,
} from "./types";

// =============================================================================
// Types
// =============================================================================

export interface TranscriptLayoutOutlineProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  toggleDisabled?: boolean;
  toggleTitle?: string;
  toggleIcon: string;
  /** Header title shown next to the toggle icon when expanded. */
  title?: string;
  /** Name of the agent/subagent currently displayed. Shown as a header in the outline. */
  name?: string;
  renderLink?: (url: string, children: ReactNode) => ReactNode;
  onNavigateToEvent?: (eventId: string) => void;
  selectedId?: string | null;
  setSelectedId?: (id: string) => void;
}

export interface TranscriptLayoutRightPaneProps {
  /** Content shown when the pane is expanded. */
  content: ReactNode;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  toggleIcon: string;
  toggleTitle?: string;
  /** Header title shown next to the toggle icon when expanded. */
  title?: string;
  /** Width (px) when expanded. Defaults to 360. */
  width?: number;
  /** When provided, the pane is resizable: callback fires with the new width during drag. */
  onWidthChange?: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  /** aria-label root for the toggle / pane region. */
  label?: string;
}

export interface TranscriptLayoutProps {
  // --- Events ---
  events: Event[];
  /** Whether events are still being streamed (enables running indicators). */
  running?: boolean;

  // --- Scroll & positioning ---
  scrollRef: RefObject<HTMLDivElement | null>;
  offsetTop?: number;

  // --- Timeline selection adapters ---
  timelineSelection?: UseTimelineProps;
  activeTimeline?: UseActiveTimelineProps;
  serverTimelines?: ServerTimeline[];

  // --- Timeline config overrides (default: useTimelineConfig()) ---
  markerConfig?: MarkerConfig;
  agentConfig?: TimelineOptions;

  // --- Swimlane control ---
  showSwimlanes?: boolean | "auto";
  onMarkerNavigate?: (eventId: string, selectedKey?: string) => void;
  onScrollToTop?: () => void;

  // --- Headroom ---
  headroomHidden?: boolean;
  onHeadroomResetAnchor?: (debounce?: boolean) => void;

  // --- Event list ---
  listId: string;
  /** Deep-link to a specific event on mount. Takes priority over initialMessageId. */
  initialEventId?: string | null;
  /** Deep-link to a message ID, resolved to the best matching event.
   *  Used for citation navigation — resolves against selected span first, then root. */
  initialMessageId?: string | null;
  eventsListRef?: RefObject<TranscriptViewNodesHandle | null>;
  getEventUrl?: (eventId: string) => string | undefined;
  linkingEnabled?: boolean;

  // --- Collapse state (from app store) ---
  /** Bulk collapse/expand of all collapsible events. Omit for no-op. */
  bulkCollapse?: "collapse" | "expand";
  collapseState?: TranscriptCollapseState;

  // --- Outline ---
  /** Outline panel configuration. When omitted, the outline column is hidden entirely. */
  outline?: TranscriptLayoutOutlineProps;
  /** Optional ref to the outline's sticky scroll container. Useful when the
   *  caller wants to observe its scroll events (e.g. headroom direction). */
  outlineScrollRef?: RefObject<HTMLDivElement | null>;

  // --- Right pane ---
  /** Optional right-side pane (mirror of outline). When omitted, the right column is hidden. */
  rightPane?: TranscriptLayoutRightPaneProps;
  /** Optional ref to the right pane's sticky scroll container. */
  rightPaneScrollRef?: RefObject<HTMLDivElement | null>;

  /** Extra context fields merged into every EventNodeContext entry. */
  eventNodeContext?: Partial<EventNodeContext>;

  /** Text shown when no events match the current filter. Pass null to disable empty state. */
  emptyText?: string | null;
  className?: string;
}

// =============================================================================
// Helpers
// =============================================================================

const collectAllCollapsibleIds = (
  nodes: EventNode[]
): Record<string, boolean> => {
  const result: Record<string, boolean> = {};
  const traverse = (nodeList: EventNode[]) => {
    for (const node of nodeList) {
      if (kCollapsibleEventTypes.includes(node.event.event)) {
        result[node.id] = true;
      }
      if (node.children.length > 0) {
        traverse(node.children);
      }
    }
  };
  traverse(nodes);
  return result;
};

// =============================================================================
// Component
// =============================================================================

export const TranscriptLayout: FC<TranscriptLayoutProps> = ({
  events,
  running = false,
  scrollRef,
  offsetTop = 0,
  timelineSelection,
  activeTimeline,
  serverTimelines,
  markerConfig: markerConfigOverride,
  agentConfig: agentConfigOverride,
  showSwimlanes: showSwimlanesOption = "auto",
  onMarkerNavigate,
  onScrollToTop,
  headroomHidden,
  onHeadroomResetAnchor,
  listId,
  initialEventId,
  initialMessageId,
  eventsListRef,
  getEventUrl,
  linkingEnabled,
  bulkCollapse,
  collapseState,
  outline,
  outlineScrollRef,
  rightPane,
  rightPaneScrollRef,
  eventNodeContext,
  emptyText = "No events match the current filter",
  className,
}) => {
  // ---------------------------------------------------------------------------
  // Timeline config (persistent user preferences)
  // ---------------------------------------------------------------------------

  const timelineConfig = useTimelineConfig();
  const resolvedMarkerConfig =
    markerConfigOverride ?? timelineConfig.markerConfig;
  const resolvedAgentConfig = agentConfigOverride ?? timelineConfig.agentConfig;

  // ---------------------------------------------------------------------------
  // Timeline pipeline
  // ---------------------------------------------------------------------------

  const {
    timeline: timelineData,
    state: timelineState,
    layouts: timelineLayouts,
    rootTimeMapping,
    selectedEvents,
    sourceSpans,
    minimapSelection,
    hasTimeline,
    timelines,
    activeTimelineIndex,
    setActiveTimeline,
    regionCounts,
    branchScrollTarget,
    highlightedKeys,
    selectedRowName,
  } = useTranscriptTimeline({
    events,
    markerConfig: resolvedMarkerConfig,
    timelineOptions: resolvedAgentConfig,
    serverTimelines,
    timelineProps: timelineSelection,
    activeTimelineProps: activeTimeline,
  });

  // ---------------------------------------------------------------------------
  // Swimlane visibility
  // ---------------------------------------------------------------------------

  const showSwimlanes = useMemo(() => {
    if (showSwimlanesOption === "auto") {
      return hasTimeline || regionCounts.size > 0 || timelines.length > 1;
    }
    return showSwimlanesOption;
  }, [showSwimlanesOption, hasTimeline, regionCounts, timelines.length]);

  const swimlanesDefaultCollapsed = useMemo(() => {
    if (
      showSwimlanesOption === "auto" &&
      !hasTimeline &&
      regionCounts.size === 0
    ) {
      return true;
    }
    return hasTimeline ? false : undefined;
  }, [showSwimlanesOption, hasTimeline, regionCounts]);

  // ---------------------------------------------------------------------------
  // Event nodes
  // ---------------------------------------------------------------------------

  const eventsForNodes = showSwimlanes ? selectedEvents : events;
  const { eventNodes, defaultCollapsedIds } = useEventNodes(
    eventsForNodes,
    running,
    showSwimlanes ? sourceSpans : undefined
  );

  // ---------------------------------------------------------------------------
  // Sticky swimlane height
  // ---------------------------------------------------------------------------

  const {
    stickySwimLaneHeight,
    isSwimLaneSticky,
    swimLaneStickyContentRef,
    handleSwimLaneStickyChange,
  } = useStickySwimLaneHeight();

  const effectiveOffsetTop = offsetTop + stickySwimLaneHeight;

  // ---------------------------------------------------------------------------
  // Per-agent list position management
  // ---------------------------------------------------------------------------

  const { effectiveListId } = useListPositionManager(
    listId,
    timelineState.selected,
    scrollRef
  );

  // ---------------------------------------------------------------------------
  // Scrubber progress
  // ---------------------------------------------------------------------------

  const [scrubberProgress, scrubTo] = useScrubberProgress(scrollRef);

  const handleScrub = useCallback(
    (progress: number) => {
      onHeadroomResetAnchor?.(true);
      scrubTo(progress);
    },
    [onHeadroomResetAnchor, scrubTo]
  );

  const swimlaneHeader = useMemo(
    () => ({
      rootLabel: timelineData.root.name,
      onScrollToTop,
      minimap: {
        root: timelineData.root,
        selection: minimapSelection,
        mapping: rootTimeMapping,
        scrubberProgress,
        onScrub: handleScrub,
      },
      timelineConfig,
      timelineSelector:
        timelines.length > 1
          ? {
              timelines,
              activeIndex: activeTimelineIndex,
              onSelect: setActiveTimeline,
            }
          : undefined,
    }),
    [
      timelineData.root,
      onScrollToTop,
      minimapSelection,
      rootTimeMapping,
      scrubberProgress,
      handleScrub,
      timelineConfig,
      timelines,
      activeTimelineIndex,
      setActiveTimeline,
    ]
  );

  // ---------------------------------------------------------------------------
  // Span selection context (agent card clicks → swimlane selection)
  // ---------------------------------------------------------------------------

  const spanSelectKeys = useMemo(
    () => buildSpanSelectKeys(timelineState.rows),
    [timelineState.rows]
  );

  const selectBySpanId = useCallback(
    (spanId: string) => {
      const key = spanSelectKeys.get(spanId);
      if (!key) return;
      timelineState.select(key.key);
    },
    [spanSelectKeys, timelineState]
  );

  // ---------------------------------------------------------------------------
  // Message ID → event resolution
  // ---------------------------------------------------------------------------

  // Resolve message ID against the selected span first, then fall back to root.
  const resolvedLocal = useMemo(() => {
    if (initialEventId || !initialMessageId) return undefined;
    const selectedSpans = getSelectedSpans(
      timelineState.rows,
      timelineState.selected
    );
    for (const span of selectedSpans) {
      const result = resolveMessageToEvent(initialMessageId, span);
      if (result && !result.agentSpanId) return result;
    }
    return undefined;
  }, [
    initialEventId,
    initialMessageId,
    timelineState.rows,
    timelineState.selected,
  ]);

  const resolvedRoot = useMemo(() => {
    if (initialEventId || !initialMessageId || resolvedLocal) return undefined;
    return resolveMessageToEvent(initialMessageId, timelineData.root);
  }, [initialEventId, initialMessageId, resolvedLocal, timelineData.root]);

  const resolved = resolvedLocal ?? resolvedRoot;

  // Side-effect: navigate to the correct swimlane when resolution came from root
  useEffect(() => {
    if (!resolvedRoot) return;
    if (resolvedRoot.agentSpanId) {
      selectBySpanId(resolvedRoot.agentSpanId);
    } else if (timelineState.selected) {
      timelineState.clearSelection();
    }
  }, [resolvedRoot, selectBySpanId, timelineState]);

  const effectiveInitialEventId =
    initialEventId ?? resolved?.eventId ?? branchScrollTarget ?? null;

  // Suppress headroom collapse when a branch click triggers a programmatic scroll
  useEffect(() => {
    if (branchScrollTarget) {
      onHeadroomResetAnchor?.(true);
    }
  }, [branchScrollTarget, onHeadroomResetAnchor]);

  // ---------------------------------------------------------------------------
  // Bulk collapse/expand
  // ---------------------------------------------------------------------------

  const onSetTranscriptCollapsed = collapseState?.onSetTranscriptCollapsed;
  useEffect(() => {
    if (events.length <= 0 || !bulkCollapse || !onSetTranscriptCollapsed) {
      return;
    }
    if (
      bulkCollapse === "expand" &&
      Object.keys(defaultCollapsedIds).length > 0
    ) {
      onSetTranscriptCollapsed(defaultCollapsedIds);
    } else if (bulkCollapse === "collapse") {
      const allCollapsibleIds = collectAllCollapsibleIds(eventNodes);
      onSetTranscriptCollapsed(allCollapsibleIds);
    }
  }, [
    defaultCollapsedIds,
    eventNodes,
    bulkCollapse,
    onSetTranscriptCollapsed,
    events.length,
  ]);

  // ---------------------------------------------------------------------------
  // Outline auto-hide
  // ---------------------------------------------------------------------------
  //
  // Track whether the outline component reports displayable nodes. When the
  // outline is collapsed (unmounted), it can't report, so we optimistically
  // fall back to eventNodes.length > 0 to keep the toggle enabled.
  //
  // Auto-hide the outline when content has no nodes (e.g. utility agent)
  // without touching the user's persistent preference. When the user navigates
  // back to an agent with outline content, the preference is still intact.

  const [reportedHasNodes, setReportedHasNodes] = useState(true);

  // Reset to optimistic when eventNodes change (e.g. agent selection changes).
  // Uses "adjust state during render" pattern to avoid an extra effect cycle.
  const [prevEventNodes, setPrevEventNodes] = useState(eventNodes);
  if (prevEventNodes !== eventNodes) {
    setPrevEventNodes(eventNodes);
    if (!reportedHasNodes) {
      setReportedHasNodes(true);
    }
  }

  const hasMatchingEvents = eventNodes.length > 0;
  const autoHidden = outline ? !reportedHasNodes && !outline.collapsed : false;
  const isOutlineCollapsed = !outline || outline.collapsed || autoHidden;

  const outlineHasNodes = isOutlineCollapsed
    ? hasMatchingEvents
    : reportedHasNodes;
  const handleOutlineHasNodesChange = useCallback((hasNodes: boolean) => {
    setReportedHasNodes(hasNodes);
  }, []);

  // ---------------------------------------------------------------------------
  // Agent card rendering
  // ---------------------------------------------------------------------------

  const renderAgentCard = useCallback(
    (node: EventNode, agentCardClassName?: string) => {
      const span = node.sourceSpan as TimelineSpan | undefined;
      if (!span) return null;
      return <AgentCardView span={span} className={agentCardClassName} />;
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Headroom reset anchor
  // ---------------------------------------------------------------------------

  const handleLayoutShift = useCallback(
    (debounce?: boolean) => onHeadroomResetAnchor?.(debounce),
    [onHeadroomResetAnchor]
  );

  // When a sidebar toggles, the layout reflows but no scroll/resize event
  // fires — so sticky-state observers (useStickyObserver, StickyScroll)
  // keep stale state. Dispatch a synthetic scroll event after the DOM has
  // settled to force them to re-measure.
  const outlineCollapsedFlag = outline?.collapsed ?? null;
  const rightPaneCollapsedFlag = rightPane?.collapsed ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const timer = setTimeout(() => {
      el.dispatchEvent(new Event("scroll"));
    }, 0);
    return () => clearTimeout(timer);
  }, [outlineCollapsedFlag, rightPaneCollapsedFlag, scrollRef]);

  // Forward wheel events from the sidebars to the main scroll container
  // only while the header above the tabs is still visible. Once the sidebar
  // is stuck at its sticky top (header fully out), wheel events stop chaining
  // so the main transcript doesn't scroll along with the sidebar.
  const effectiveOffsetTopRef = useRef(effectiveOffsetTop);
  useEffect(() => {
    effectiveOffsetTopRef.current = effectiveOffsetTop;
  }, [effectiveOffsetTop]);

  useEffect(() => {
    const main = scrollRef.current;
    const outlineEl = outlineScrollRef?.current ?? null;
    const rightEl = rightPaneScrollRef?.current ?? null;
    if (!main) return;

    const makeHandler = (sidebar: HTMLDivElement) => (e: WheelEvent) => {
      const mainMaxTop = main.scrollHeight - main.clientHeight;
      // Is the sidebar currently stuck at its sticky top? If so, the header
      // above the tabs has already scrolled off — don't chain further main
      // scrolling or the transcript itself would move with the sidebar.
      const mainRect = main.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const sidebarTopInScroller = sidebarRect.top - mainRect.top;
      const sidebarIsSticky =
        sidebarTopInScroller <= effectiveOffsetTopRef.current + 1;

      if (!sidebarIsSticky) {
        // Header still visible — forward all wheel input to the main
        // scroller so that the header collapses/expands. Suppress the
        // sidebar's default scroll for this step.
        const canMain =
          (e.deltaY > 0 && main.scrollTop < mainMaxTop - 0.5) ||
          (e.deltaY < 0 && main.scrollTop > 0.5);
        if (canMain) {
          e.preventDefault();
          main.scrollBy({ top: e.deltaY, behavior: "auto" });
        }
      } else if (
        e.deltaY < 0 &&
        sidebar.scrollTop <= 0 &&
        main.scrollTop > 0
      ) {
        // Sidebar is sticky and already at its own top — wheeling up should
        // bring the header back, so forward to main.
        e.preventDefault();
        main.scrollBy({ top: e.deltaY, behavior: "auto" });
      }
      // Otherwise let the sidebar's native wheel scroll proceed.
    };

    const targets = [outlineEl, rightEl].filter(
      (el): el is HTMLDivElement => el != null
    );
    const entries = targets.map((t) => {
      const handler = makeHandler(t);
      // passive: false so we can preventDefault when taking over the scroll.
      t.addEventListener("wheel", handler, { passive: false });
      return { t, handler };
    });
    return () => {
      for (const { t, handler } of entries) {
        t.removeEventListener("wheel", handler);
      }
    };
  }, [
    scrollRef,
    outlineScrollRef,
    rightPaneScrollRef,
    // Re-attach when collapse state changes (the scroll elements may have
    // unmounted/remounted via the conditional render).
    outlineCollapsedFlag,
    rightPaneCollapsedFlag,
  ]);

  // Track the scroll container's visible height so sticky sidebars can cap
  // their max-height to the actually-visible area (100vh would include the
  // app navbar above the scroll container, leaving content unreachable).
  // Use getBoundingClientRect().height — this matches what's actually on
  // screen (clientHeight can report slightly different values depending on
  // scrollbar / box-sizing quirks).
  const [scrollerHeight, setScrollerHeight] = useState<number>(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrollerHeight(el.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [scrollRef]);

  // ---------------------------------------------------------------------------
  // Right pane resize
  // ---------------------------------------------------------------------------

  const rightPaneWidth = rightPane?.width ?? 360;
  const rightPaneMinWidth = rightPane?.minWidth ?? 240;
  const rightPaneMaxWidth = rightPane?.maxWidth ?? 800;
  const rightPaneOnWidthChange = rightPane?.onWidthChange;
  const rightPaneDragRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleRightPanePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!rightPaneOnWidthChange) return;
      e.preventDefault();
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
      rightPaneDragRef.current = {
        startX: e.clientX,
        startWidth: rightPaneWidth,
      };
    },
    [rightPaneOnWidthChange, rightPaneWidth]
  );

  const handleRightPanePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!rightPaneOnWidthChange || !rightPaneDragRef.current) return;
      const { startX, startWidth } = rightPaneDragRef.current;
      const next = startWidth - (e.clientX - startX);
      const clamped = Math.max(
        rightPaneMinWidth,
        Math.min(rightPaneMaxWidth, next)
      );
      rightPaneOnWidthChange(clamped);
    },
    [rightPaneOnWidthChange, rightPaneMinWidth, rightPaneMaxWidth]
  );

  const handleRightPanePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      rightPaneDragRef.current = null;
      try {
        (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        // pointer may already be released
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <TimelineSelectContext.Provider value={selectBySpanId}>
      <div className={clsx(styles.root, className)}>
        {showSwimlanes && (
          <StickyScroll
            scrollRef={scrollRef}
            offsetTop={offsetTop}
            zIndex={500}
            preserveHeight={true}
            onStickyChange={handleSwimLaneStickyChange}
          >
            <div ref={swimLaneStickyContentRef}>
              <TimelineSwimLanes
                layouts={timelineLayouts}
                timeline={timelineState}
                header={swimlaneHeader}
                onMarkerNavigate={onMarkerNavigate}
                isSticky={isSwimLaneSticky}
                headroomCollapsed={!!headroomHidden && isSwimLaneSticky}
                onLayoutShift={handleLayoutShift}
                defaultCollapsed={swimlanesDefaultCollapsed}
                regionCounts={regionCounts}
                highlightedKeys={highlightedKeys}
              />
            </div>
          </StickyScroll>
        )}
        <div
          className={clsx(
            styles.container,
            !outline && styles.noOutline,
            outline && isOutlineCollapsed && styles.outlineCollapsed,
            !rightPane && styles.noRightPane,
            rightPane && rightPane.collapsed && styles.rightPaneCollapsed
          )}
          style={
            {
              "--outline-top": `${effectiveOffsetTop}px`,
              "--right-pane-width": `${rightPaneWidth}px`,
              "--scroller-height": scrollerHeight
                ? `${scrollerHeight}px`
                : "100vh",
            } as CSSProperties
          }
        >
          {outline && (
            <>
              <StickyScroll
                ref={outlineScrollRef}
                scrollRef={scrollRef}
                className={styles.outline}
                offsetTop={effectiveOffsetTop}
              >
                {!isOutlineCollapsed ? (
                  <>
                    {outline.title && (
                      <div className={styles.sidebarHeader}>
                        <span
                          className={clsx(
                            styles.sidebarHeaderTitle,
                            "text-size-smaller"
                          )}
                        >
                          {outline.title}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={styles.sidebarHeaderClose}
                      onClick={() => outline.onCollapsedChange(true)}
                      aria-label="Hide outline"
                      title={outline.toggleTitle ?? "Hide outline"}
                    >
                      <i className="bi bi-x" />
                    </button>
                    <TranscriptOutline
                      eventNodes={eventNodes}
                      defaultCollapsedIds={defaultCollapsedIds}
                      scrollRef={scrollRef}
                      running={running}
                      agentName={
                        outline.name ??
                        (showSwimlanes ? selectedRowName : undefined)
                      }
                      scrollTrackOffset={effectiveOffsetTop}
                      getCollapsed={
                        collapseState?.outline
                          ? (nodeId: string) =>
                              collapseState.outline?.[nodeId] === true
                          : undefined
                      }
                      setCollapsed={collapseState?.onCollapseOutline}
                      collapsedEvents={collapseState?.outline}
                      setCollapsedEvents={collapseState?.onSetOutlineCollapsed}
                      selectedOutlineId={outline.selectedId}
                      setSelectedOutlineId={outline.setSelectedId}
                      getEventUrl={getEventUrl}
                      renderLink={outline.renderLink}
                      onNavigateToEvent={outline.onNavigateToEvent}
                      onHasNodesChange={handleOutlineHasNodesChange}
                    />
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.outlineToggle}
                    onClick={
                      outlineHasNodes && !outline.toggleDisabled
                        ? () => outline.onCollapsedChange(false)
                        : undefined
                    }
                    aria-disabled={outline.toggleDisabled || !outlineHasNodes}
                    title={
                      outline.toggleTitle ??
                      (!outlineHasNodes
                        ? "No outline available for the current filter"
                        : undefined)
                    }
                    aria-label="Show outline"
                  >
                    <i className={outline.toggleIcon} />
                  </button>
                )}
              </StickyScroll>
              <div className={styles.separator} />
            </>
          )}
          {hasMatchingEvents ? (
            <TranscriptViewNodes
              key={effectiveListId}
              ref={eventsListRef}
              id={effectiveListId}
              eventNodes={eventNodes}
              defaultCollapsedIds={defaultCollapsedIds}
              running={running}
              initialEventId={effectiveInitialEventId}
              offsetTop={effectiveOffsetTop}
              className={styles.eventsList}
              scrollRef={scrollRef}
              renderAgentCard={showSwimlanes ? renderAgentCard : undefined}
              getEventUrl={getEventUrl}
              linkingEnabled={linkingEnabled}
              collapsedTranscript={collapseState?.transcript}
              collapsedOutline={collapseState?.outline}
              onCollapseTranscript={collapseState?.onCollapseTranscript}
              eventNodeContext={eventNodeContext}
            />
          ) : emptyText !== null ? (
            <NoContentsPanel text={emptyText} />
          ) : null}
          {rightPane && (
            <>
              <div className={styles.rightSeparator} />
              <StickyScroll
                ref={rightPaneScrollRef}
                scrollRef={scrollRef}
                className={styles.rightPane}
                offsetTop={effectiveOffsetTop}
              >
                {!rightPane.collapsed ? (
                  <>
                    {rightPaneOnWidthChange && (
                      <div
                        className={styles.rightPaneResizer}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${rightPane.label ?? "pane"}`}
                        onPointerDown={handleRightPanePointerDown}
                        onPointerMove={handleRightPanePointerMove}
                        onPointerUp={handleRightPanePointerUp}
                        onPointerCancel={handleRightPanePointerUp}
                      />
                    )}
                    {rightPane.title && (
                      <div className={styles.sidebarHeader}>
                        <span
                          className={clsx(
                            styles.sidebarHeaderTitle,
                            "text-size-smaller"
                          )}
                        >
                          {rightPane.title}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={styles.sidebarHeaderClose}
                      onClick={() => rightPane.onCollapsedChange(true)}
                      aria-label={`Hide ${rightPane.label ?? "pane"}`}
                      title={
                        rightPane.toggleTitle ??
                        `Hide ${rightPane.label ?? "pane"}`
                      }
                    >
                      <i className="bi bi-x" />
                    </button>
                    {rightPane.content}
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.rightPaneToggle}
                    onClick={() => rightPane.onCollapsedChange(false)}
                    title={
                      rightPane.toggleTitle ??
                      `Show ${rightPane.label ?? "pane"}`
                    }
                    aria-label={`Show ${rightPane.label ?? "pane"}`}
                  >
                    <i className={rightPane.toggleIcon} />
                  </button>
                )}
              </StickyScroll>
            </>
          )}
        </div>
      </div>
    </TimelineSelectContext.Provider>
  );
};
