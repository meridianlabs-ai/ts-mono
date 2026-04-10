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
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
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
  /** Name of the agent/subagent currently displayed. Shown as a header in the outline. */
  name?: string;
  renderLink?: (url: string, children: ReactNode) => ReactNode;
  onNavigateToEvent?: (eventId: string) => void;
  selectedId?: string | null;
  setSelectedId?: (id: string) => void;
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
  outline: TranscriptLayoutOutlineProps;

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

  const timelineProps = useMemo(
    () =>
      timelineSelection
        ? {
            timelineProps: timelineSelection,
            activeTimelineProps: activeTimeline,
          }
        : undefined,
    [timelineSelection, activeTimeline]
  );

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
    outlineAgentName,
  } = useTranscriptTimeline(
    events,
    resolvedMarkerConfig,
    resolvedAgentConfig,
    serverTimelines,
    timelineProps
  );

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
  const autoHidden = !reportedHasNodes && !outline.collapsed;
  const isOutlineCollapsed = outline.collapsed || autoHidden;

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
    (node: EventNode, agentCardClassName?: string | string[]) => {
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
                header={{
                  rootLabel: timelineData.root.name,
                  ...(onScrollToTop ? { onScrollToTop } : undefined),
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
                }}
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
            isOutlineCollapsed && styles.outlineCollapsed
          )}
          style={
            {
              "--outline-top": `${effectiveOffsetTop}px`,
            } as CSSProperties
          }
        >
          <StickyScroll
            scrollRef={scrollRef}
            className={styles.outline}
            offsetTop={effectiveOffsetTop}
          >
            {!isOutlineCollapsed && (
              <TranscriptOutline
                eventNodes={eventNodes}
                defaultCollapsedIds={defaultCollapsedIds}
                scrollRef={scrollRef}
                running={running}
                agentName={
                  outline.name ?? (showSwimlanes ? outlineAgentName : undefined)
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
            )}
            <button
              type="button"
              className={styles.outlineToggle}
              onClick={
                outlineHasNodes && !outline.toggleDisabled
                  ? () => outline.onCollapsedChange(!isOutlineCollapsed)
                  : undefined
              }
              aria-disabled={outline.toggleDisabled || !outlineHasNodes}
              title={
                outline.toggleTitle ??
                (!outlineHasNodes
                  ? "No outline available for the current filter"
                  : undefined)
              }
              aria-label={isOutlineCollapsed ? "Show outline" : "Hide outline"}
            >
              <i className={outline.toggleIcon} />
            </button>
          </StickyScroll>
          <div className={styles.separator} />
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
            />
          ) : emptyText !== null ? (
            <NoContentsPanel text={emptyText} />
          ) : null}
        </div>
      </div>
    </TimelineSelectContext.Provider>
  );
};
