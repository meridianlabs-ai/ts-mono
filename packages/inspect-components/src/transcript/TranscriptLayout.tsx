/**
 * Shared layout component for transcript views.
 *
 * Encapsulates the full visual structure: timeline swimlanes, transcript
 * outline, and virtualized event list. Apps provide events, selection
 * state adapters, and store-backed collapse callbacks.
 */

import clsx from "clsx";
import {
  CSSProperties,
  FC,
  ReactNode,
  RefObject,
  useCallback,
  useMemo,
} from "react";

import type {
  Event,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";
import { StickyScroll } from "@tsmono/react/components";
import { useScrubberProgress } from "@tsmono/react/hooks";

import { TranscriptOutline } from "./outline/TranscriptOutline";
import {
  AgentCardView,
  TimelineSwimLanes,
} from "./timeline/components";
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
import { buildSpanSelectKeys } from "./timeline/timelineEventNodes";
import {
  TimelineSelectContext,
} from "./TimelineSelectContext";
import {
  TranscriptViewNodes,
  type TranscriptViewNodesHandle,
} from "./TranscriptViewNodes";
import { EventNode, kTranscriptOutlineCollapseScope } from "./types";
import { useListPositionManager } from "./hooks/useListPositionManager";
import { useStickySwimLaneHeight } from "./hooks/useStickySwimLaneHeight";

import styles from "./TranscriptLayout.module.css";

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
  onHasNodesChange?: (hasNodes: boolean) => void;
  selectedId?: string | null;
  setSelectedId?: (id: string | null) => void;
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
  swimlaneHeaderExtras?: { onScrollToTop?: () => void };

  // --- Headroom ---
  headroomHidden?: boolean;
  onHeadroomResetAnchor?: (debounce?: boolean) => void;

  // --- Event list ---
  listId: string;
  initialEventId?: string | null;
  eventsListRef?: RefObject<TranscriptViewNodesHandle | null>;
  getEventUrl?: (eventId: string) => string | undefined;
  linkingEnabled?: boolean;

  // --- Collapse state (from app store) ---
  collapsedEvents?: Record<string, Record<string, boolean> | undefined>;
  onCollapse?: (scope: string, nodeId: string, collapsed: boolean) => void;
  onSetCollapsedEvents?: (scope: string, ids: Record<string, boolean>) => void;

  // --- Outline ---
  outline: TranscriptLayoutOutlineProps;

  className?: string;
}

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
  swimlaneHeaderExtras,
  headroomHidden,
  onHeadroomResetAnchor,
  listId,
  initialEventId,
  eventsListRef,
  getEventUrl,
  linkingEnabled,
  collapsedEvents,
  onCollapse,
  onSetCollapsedEvents,
  outline,
  className,
}) => {
  // ---------------------------------------------------------------------------
  // Timeline config (persistent user preferences)
  // ---------------------------------------------------------------------------

  const timelineConfig = useTimelineConfig();
  const resolvedMarkerConfig =
    markerConfigOverride ?? timelineConfig.markerConfig;
  const resolvedAgentConfig =
    agentConfigOverride ?? timelineConfig.agentConfig;

  // ---------------------------------------------------------------------------
  // Timeline pipeline
  // ---------------------------------------------------------------------------

  const timelineProps = useMemo(
    () =>
      timelineSelection
        ? { timelineProps: timelineSelection, activeTimelineProps: activeTimeline }
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
    if (showSwimlanesOption === "auto" && !hasTimeline && regionCounts.size === 0) {
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
                  ...(swimlaneHeaderExtras?.onScrollToTop
                    ? { onScrollToTop: swimlaneHeaderExtras.onScrollToTop }
                    : undefined),
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
            outline.collapsed && styles.outlineCollapsed
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
            {!outline.collapsed && (
              <TranscriptOutline
                eventNodes={eventNodes}
                defaultCollapsedIds={defaultCollapsedIds}
                scrollRef={scrollRef}
                running={running}
                agentName={outline.name ?? (showSwimlanes ? outlineAgentName : undefined)}
                scrollTrackOffset={effectiveOffsetTop}
                getCollapsed={
                  collapsedEvents
                    ? (scope: string, nodeId: string) =>
                        collapsedEvents[scope]?.[nodeId] === true
                    : undefined
                }
                setCollapsed={onCollapse}
                getCollapsedEvents={
                  collapsedEvents
                    ? () =>
                        collapsedEvents[kTranscriptOutlineCollapseScope] as
                          | Record<string, boolean>
                          | undefined
                    : undefined
                }
                setCollapsedEvents={onSetCollapsedEvents}
                selectedOutlineId={outline.selectedId}
                setSelectedOutlineId={outline.setSelectedId}
                getEventUrl={getEventUrl}
                renderLink={outline.renderLink}
                onNavigateToEvent={outline.onNavigateToEvent}
                onHasNodesChange={outline.onHasNodesChange}
              />
            )}
            <button
              type="button"
              className={styles.outlineToggle}
              onClick={
                !outline.toggleDisabled
                  ? () => outline.onCollapsedChange(!outline.collapsed)
                  : undefined
              }
              aria-disabled={outline.toggleDisabled}
              title={outline.toggleTitle}
              aria-label={outline.collapsed ? "Show outline" : "Hide outline"}
            >
              <i className={outline.toggleIcon} />
            </button>
          </StickyScroll>
          <div className={styles.separator} />
          <TranscriptViewNodes
            key={effectiveListId}
            ref={eventsListRef}
            id={effectiveListId}
            eventNodes={eventNodes}
            defaultCollapsedIds={defaultCollapsedIds}
            initialEventId={initialEventId}
            offsetTop={effectiveOffsetTop}
            className={styles.eventsList}
            scrollRef={scrollRef}
            renderAgentCard={showSwimlanes ? renderAgentCard : undefined}
            getEventUrl={getEventUrl}
            linkingEnabled={linkingEnabled}
            collapsedEvents={collapsedEvents}
            onCollapse={onCollapse}
          />
        </div>
      </div>
    </TimelineSelectContext.Provider>
  );
};
