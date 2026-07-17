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
  useRef,
  useState,
} from "react";

import type {
  Event,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";
import {
  NoContentsPanel,
  RailDock,
  StickyScroll,
} from "@tsmono/react/components";
import { useElementHeight, useScrubberProgress } from "@tsmono/react/hooks";

import { useDeepLinkResolution } from "./hooks/useDeepLinkResolution";
import { useEventNodeData } from "./hooks/useEventNodeData";
import { useListPositionManager } from "./hooks/useListPositionManager";
import { useOutlineAutoHide } from "./hooks/useOutlineAutoHide";
import { useSelectionActions } from "./hooks/useSelectionActions";
import { useSidebarScrollCoupling } from "./hooks/useSidebarScrollCoupling";
import { useStickySwimLaneHeight } from "./hooks/useStickySwimLaneHeight";
import { useTimelinePipeline } from "./hooks/useTimelinePipeline";
import { useTranscriptCollapse } from "./hooks/useTranscriptCollapse";
import { TranscriptOutline } from "./outline/TranscriptOutline";
import { useTranscriptSearchSource } from "./search";
import { AgentCardView, TimelineSwimLanes } from "./timeline/components";
import { type TimelineSpan } from "./timeline/core";
import {
  type TimelineOptions,
  type UseActiveTimelineProps,
  type UseTimelineProps,
} from "./timeline/hooks";
import { type MarkerConfig } from "./timeline/markers";
import {
  TimelineRowSelectContext,
  TimelineSelectContext,
} from "./TimelineSelectContext";
import styles from "./TranscriptLayout.module.css";
import {
  TranscriptViewNodes,
  type TranscriptViewNodesHandle,
} from "./TranscriptViewNodes";
import {
  EventNode,
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

export interface TranscriptLayoutRightRailProps {
  /** Always-visible rail content (the vertical activity bar). */
  rail: ReactNode;
  /** Panel content shown in a column to the LEFT of the rail. Null = no panel open. */
  panel?: ReactNode;
  /** Fixed rail width in px. Defaults to 44. */
  railWidth?: number;
  /** Controlled panel width (px). Pair with onPanelWidthChange so dragging
   *  still applies; omit both for panel-local width (360 default). */
  panelWidth?: number;
  /** Called with the new width as the user drags the panel's resize handle. */
  onPanelWidthChange?: (width: number) => void;
  panelMinWidth?: number;
  panelMaxWidth?: number;
  /** aria-label root for the panel region. */
  label?: string;
}

export interface TranscriptLayoutProps {
  // --- Events ---
  events: Event[];
  /** Event types to hide from the rendered card list. Applied after timeline
   *  construction so structural events (anchor/branch) still resolve. */
  hiddenEventTypes?: readonly string[];
  /** Whether events are still being streamed (enables running indicators). */
  running?: boolean;
  /** Whether the sample's event backlog is still loading (live sample). */
  backfilling?: boolean;

  // --- Scroll & positioning ---
  scrollRef: RefObject<HTMLDivElement | null>;
  offsetTop?: number;
  /** Size the layout to its content instead of filling the viewport. Use when
   *  embedding the transcript inside another scroll container (e.g. a card)
   *  rather than as the page's primary scroll region. */
  embedded?: boolean;

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
  /** Force the headroom into the given hidden state. Used by sources (e.g.
   *  search) that drive scroll-direction-sensitive UI when their motion
   *  doesn't match what the scroll-direction tracker would infer. */
  onHeadroomSetHidden?: (hidden: boolean) => void;
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

  // --- Right rail ---
  /** Optional always-visible right rail + optional panel. */
  rightRail?: TranscriptLayoutRightRailProps;
  /** Optional ref to the rail panel's sticky scroll container (wheel forwarding). */
  rightRailPanelScrollRef?: RefObject<HTMLDivElement | null>;

  /** Extra context fields merged into every EventNodeContext entry. */
  eventNodeContext?: Partial<EventNodeContext>;

  /** Text shown when no events match the current filter. Pass null to disable empty state. */
  emptyText?: string | null;
  /** Render the empty state as an in-progress placeholder (animated, no icon). */
  emptyBusy?: boolean;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const TranscriptLayout: FC<TranscriptLayoutProps> = ({
  events,
  hiddenEventTypes,
  running = false,
  backfilling = false,
  scrollRef,
  offsetTop = 0,
  embedded = false,
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
  onHeadroomSetHidden,
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
  rightRail,
  rightRailPanelScrollRef,
  eventNodeContext,
  emptyText = "No events match the current filter",
  emptyBusy,
  className,
}) => {
  // ---------------------------------------------------------------------------
  // Timeline pipeline + event nodes
  // ---------------------------------------------------------------------------

  const {
    timeline: transcriptTimeline,
    timelineConfig,
    showSwimlanes,
    swimlanesDefaultCollapsed,
    nodeFeed,
    searchableEvents,
  } = useTimelinePipeline({
    events,
    hiddenEventTypes,
    serverTimelines,
    markerConfig: markerConfigOverride,
    agentConfig: agentConfigOverride,
    showSwimlanes: showSwimlanesOption,
    timelineSelection,
    activeTimeline,
  });

  const {
    state: timelineState,
    swimlanes: { layouts: timelineLayouts, regionCounts, highlightedKeys },
    minimap,
    multiTimeline,
    views,
    selection: { rowName: selectedRowName },
  } = transcriptTimeline;

  const {
    eventNodes,
    defaultCollapsedIds,
    eventNodeContext: mergedEventNodeContext,
  } = useEventNodeData(nodeFeed, running, eventNodeContext);

  const nullViewNodesRef = useRef<TranscriptViewNodesHandle | null>(null);

  useTranscriptSearchSource({
    id: listId,
    events: searchableEvents,
    rows: timelineState.rows,
    selected: timelineSelection?.selected ?? null,
    onSelect: timelineSelection?.onSelect ?? (() => {}),
    viewNodesRef: eventsListRef ?? nullViewNodesRef,
    onHeadroomResetAnchor,
    onHeadroomSetHidden,
  });

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
  // Selection actions + per-agent list position management
  // ---------------------------------------------------------------------------

  const { spanSelectKeys, selectBySpanId, selectByRowKey, hasScrollTarget } =
    useSelectionActions({
      timelineState,
      scrollRef,
      initialEventId,
      initialMessageId,
    });

  const { effectiveListId } = useListPositionManager(
    listId,
    timelineState.selected,
    scrollRef,
    hasScrollTarget
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
      onScrollToTop,
      minimap,
      scrubberProgress,
      onScrub: handleScrub,
      timelineConfig,
      multiTimeline,
      views,
    }),
    [
      onScrollToTop,
      minimap,
      scrubberProgress,
      handleScrub,
      timelineConfig,
      multiTimeline,
      views,
    ]
  );

  // ---------------------------------------------------------------------------
  // Deep-link resolution
  // ---------------------------------------------------------------------------

  const { effectiveInitialEventId } = useDeepLinkResolution({
    initialEventId,
    initialMessageId,
    timeline: transcriptTimeline,
    spanSelectKeys,
    showSwimlanes,
    nodeFeedEvents: nodeFeed.events,
  });

  // Suppress headroom (swimlane collapse/expand) during programmatic scrolls
  // — fires for any change to the effective scroll target (URL `?event=`,
  // resolved message, branch switch). The reset-anchor uses a debounced
  // lock that stays active while the imperative scroll's retry loop keeps
  // emitting scroll events, so the swimlane doesn't flicker open/closed
  // during the multi-pass settling.
  useEffect(() => {
    if (effectiveInitialEventId) {
      onHeadroomResetAnchor?.(true);
    }
  }, [effectiveInitialEventId, onHeadroomResetAnchor]);

  // ---------------------------------------------------------------------------
  // Collapse state & outline auto-hide
  // ---------------------------------------------------------------------------

  const { onCollapseTranscript, onExpandNodes } = useTranscriptCollapse({
    eventNodes,
    defaultCollapsedIds,
    collapseState,
    bulkCollapse,
    eventCount: events.length,
  });

  const { isOutlineCollapsed, outlineHasNodes, onOutlineHasNodesChange } =
    useOutlineAutoHide({
      eventNodes,
      hasOutline: !!outline,
      outlineCollapsed: outline?.collapsed,
    });

  const outlineCollapse = useMemo(
    () =>
      collapseState
        ? {
            collapsed: collapseState.outline,
            onCollapse: collapseState.onCollapseOutline,
            onSetCollapsed: collapseState.onSetOutlineCollapsed,
          }
        : undefined,
    [collapseState]
  );

  const hasMatchingEvents = eventNodes.length > 0;

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

  // The rail panel pins directly below the toolbar (offsetTop), alongside
  // the timeline; the outline pins below the swimlanes (effectiveOffsetTop).
  // Each needs its own sticky-detection threshold. The remount keys re-attach
  // listeners when collapse state changes (the scroll elements may have
  // unmounted/remounted via the conditional render).
  const outlineCollapsedFlag = outline?.collapsed ?? null;
  const railPanelOpenFlag = rightRail?.panel != null;
  const sidebarTargets = useMemo(
    () => [
      { scrollRef: outlineScrollRef, remountKey: outlineCollapsedFlag },
      { scrollRef: rightRailPanelScrollRef, remountKey: railPanelOpenFlag },
    ],
    [
      outlineScrollRef,
      rightRailPanelScrollRef,
      outlineCollapsedFlag,
      railPanelOpenFlag,
    ]
  );
  useSidebarScrollCoupling({
    mainScrollRef: scrollRef,
    sidebars: sidebarTargets,
    stickyTops: [effectiveOffsetTop, offsetTop],
  });

  // Capture the outline's own scroll container (the StickyScroll div, which
  // has overflow-y:auto) into state so the outline's Virtuoso can use it as
  // its scroll parent. Resolving into state (rather than reading a ref during
  // render) guarantees a re-render once the element mounts. Also mirror it
  // into the optional external ref callers pass for wheel forwarding.
  const [outlineScrollEl, setOutlineScrollEl] = useState<HTMLDivElement | null>(
    null
  );
  const handleOutlineScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      setOutlineScrollEl(el);
      if (outlineScrollRef) {
        outlineScrollRef.current = el;
      }
    },
    [outlineScrollRef]
  );

  // Track the scroll container's visible height so sticky sidebars can cap
  // their max-height to the actually-visible area (100vh would include the
  // app navbar above the scroll container, leaving content unreachable).
  const scrollerHeight = useElementHeight(scrollRef);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <TimelineSelectContext.Provider value={selectBySpanId}>
      <TimelineRowSelectContext.Provider value={selectByRowKey}>
        <div className={clsx(styles.root, className)}>
          <div className={styles.main}>
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
                    onPunchDown={views.pushByRowKey}
                  />
                </div>
              </StickyScroll>
            )}
            <div
              className={clsx(
                styles.container,
                embedded && styles.embedded,
                !outline && styles.noOutline,
                outline && isOutlineCollapsed && styles.outlineCollapsed
              )}
              style={
                {
                  "--outline-top": `${effectiveOffsetTop}px`,
                  "--scroller-height": scrollerHeight
                    ? `${scrollerHeight}px`
                    : "100vh",
                } as CSSProperties
              }
            >
              {outline && (
                <>
                  <StickyScroll
                    ref={handleOutlineScrollRef}
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
                        <div className={styles.sidebarHeaderCloseAnchor}>
                          <button
                            type="button"
                            className={styles.sidebarHeaderClose}
                            onClick={() => outline.onCollapsedChange(true)}
                            aria-label="Hide outline"
                            title={outline.toggleTitle ?? "Hide outline"}
                          >
                            <i className="bi bi-x" />
                          </button>
                        </div>
                        <TranscriptOutline
                          eventNodes={eventNodes}
                          defaultCollapsedIds={defaultCollapsedIds}
                          scrollRef={scrollRef}
                          outlineScrollEl={outlineScrollEl}
                          running={running}
                          backfilling={backfilling}
                          agentName={
                            outline.name ??
                            (showSwimlanes ? selectedRowName : undefined)
                          }
                          scrollTrackOffset={effectiveOffsetTop}
                          collapse={outlineCollapse}
                          selectedOutlineId={outline.selectedId}
                          setSelectedOutlineId={outline.setSelectedId}
                          getEventUrl={getEventUrl}
                          renderLink={outline.renderLink}
                          onNavigateToEvent={outline.onNavigateToEvent}
                          onHasNodesChange={onOutlineHasNodesChange}
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
                        aria-disabled={
                          outline.toggleDisabled || !outlineHasNodes
                        }
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
                  backfilling={backfilling}
                  initialEventId={effectiveInitialEventId}
                  initialMessageId={initialMessageId}
                  offsetTop={effectiveOffsetTop}
                  className={styles.eventsList}
                  scrollRef={scrollRef}
                  renderAgentCard={showSwimlanes ? renderAgentCard : undefined}
                  getEventUrl={getEventUrl}
                  linkingEnabled={linkingEnabled}
                  collapsedTranscript={collapseState?.transcript}
                  collapsedOutline={collapseState?.outline}
                  onCollapseTranscript={onCollapseTranscript}
                  onExpandNodes={onExpandNodes}
                  eventNodeContext={mergedEventNodeContext}
                />
              ) : emptyText !== null ? (
                <NoContentsPanel text={emptyText} busy={emptyBusy} />
              ) : null}
            </div>
          </div>
          {/* The rail (and its optional resizable panel) render as a flex
              region to the right of the timeline + content, so they run full
              height starting directly below the toolbar rather than below the
              swimlanes. */}
          {rightRail && (
            <RailDock
              rail={rightRail.rail}
              panel={rightRail.panel}
              scrollRef={scrollRef}
              scrollerHeight={scrollerHeight}
              offsetTop={offsetTop}
              panelScrollRef={rightRailPanelScrollRef}
              railWidth={rightRail.railWidth}
              panelWidth={rightRail.panelWidth}
              onPanelWidthChange={rightRail.onPanelWidthChange}
              panelMinWidth={rightRail.panelMinWidth}
              panelMaxWidth={rightRail.panelMaxWidth}
              label={rightRail.label}
            />
          )}
        </div>
      </TimelineRowSelectContext.Provider>
    </TimelineSelectContext.Provider>
  );
};
