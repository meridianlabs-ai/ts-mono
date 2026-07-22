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
  useMemo,
  useRef,
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
import { useElementHeight } from "@tsmono/react/hooks";

import { useDeepLinkResolution } from "./hooks/useDeepLinkResolution";
import { useEventNodeData } from "./hooks/useEventNodeData";
import { useListPositionManager } from "./hooks/useListPositionManager";
import { useOutlineAutoHide } from "./hooks/useOutlineAutoHide";
import { useSelectionActions } from "./hooks/useSelectionActions";
import { useSidebarScrollCoupling } from "./hooks/useSidebarScrollCoupling";
import { useStickySwimLaneHeight } from "./hooks/useStickySwimLaneHeight";
import { useSwimlaneHeader } from "./hooks/useSwimlaneHeader";
import { useTimelinePipeline } from "./hooks/useTimelinePipeline";
import { useTranscriptCollapse } from "./hooks/useTranscriptCollapse";
import {
  OutlineSidebar,
  type TranscriptLayoutOutlineProps,
} from "./OutlineSidebar";
import { useTranscriptSearchSource } from "./search";
import { AgentCardView, TimelineSwimLanes } from "./timeline/components";
import { countUtilitySpans, type TimelineSpan } from "./timeline/core";
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

export { type TranscriptLayoutOutlineProps } from "./OutlineSidebar";

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

/** Timeline data, selection adapters, and swimlane behavior
 *  (consumed by the timeline pipeline + swimlane header). */
export interface TranscriptLayoutTimelineProps {
  /** Row selection state adapter. */
  selection?: UseTimelineProps;
  /** Active-timeline adapter (multi-timeline logs). */
  active?: UseActiveTimelineProps;
  serverTimelines?: ServerTimeline[];
  /** Marker config override (default: useTimelineConfig()). */
  markerConfig?: MarkerConfig;
  /** Agent timeline options override (default: useTimelineConfig()). */
  agentConfig?: TimelineOptions;
  /** Swimlane visibility. "auto" (the default) shows them when the timeline
   *  has agent structure. */
  showSwimlanes?: boolean | "auto";
  onMarkerNavigate?: (eventId: string, selectedKey?: string) => void;
  /** Called on swimlane header click to scroll the view to the top. */
  onScrollToTop?: () => void;
}

/** Deep-link target resolved on mount (consumed by useDeepLinkResolution). */
export interface TranscriptLayoutDeepLinkProps {
  /** Deep-link to a specific event. Takes priority over messageId. */
  eventId?: string | null;
  /** Deep-link to a message ID, resolved to the best matching event.
   *  Used for citation navigation — resolves against selected span first, then root. */
  messageId?: string | null;
}

/** Adapter for the host's headroom (collapsing chrome above the transcript). */
export interface TranscriptLayoutHeadroomProps {
  hidden?: boolean;
  /** Force the headroom into the given hidden state. Used by sources (e.g.
   *  search) that drive scroll-direction-sensitive UI when their motion
   *  doesn't match what the scroll-direction tracker would infer. */
  onSetHidden?: (hidden: boolean) => void;
  onResetAnchor?: (debounce?: boolean) => void;
}

/** Empty-state display when no events match the current filter. */
export interface TranscriptLayoutEmptyProps {
  /** Text shown when no events match. Pass null to disable the empty state. */
  text?: string | null;
  /** Render the empty state as an in-progress placeholder (animated, no icon). */
  busy?: boolean;
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

  // --- Feature groups ---
  /** Timeline data, selection adapters, and swimlane behavior. */
  timeline?: TranscriptLayoutTimelineProps;
  /** Deep-link target resolved on mount. */
  deepLink?: TranscriptLayoutDeepLinkProps;
  /** Host headroom adapter. */
  headroom?: TranscriptLayoutHeadroomProps;
  /** Empty-state display. Omit for the default text. */
  empty?: TranscriptLayoutEmptyProps;

  // --- Event list ---
  listId: string;
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

  // --- Right rail ---
  /** Optional always-visible right rail + optional panel. */
  rightRail?: TranscriptLayoutRightRailProps;

  /** Extra context fields merged into every EventNodeContext entry. */
  eventNodeContext?: Partial<EventNodeContext>;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

function renderAgentCard(node: EventNode, agentCardClassName?: string) {
  const span = node.sourceSpan as TimelineSpan | undefined;
  if (!span) return null;
  return <AgentCardView span={span} className={agentCardClassName} />;
}

export const TranscriptLayout: FC<TranscriptLayoutProps> = ({
  events,
  hiddenEventTypes,
  running = false,
  backfilling = false,
  scrollRef,
  offsetTop = 0,
  embedded = false,
  timeline,
  deepLink,
  headroom,
  empty,
  listId,
  eventsListRef,
  getEventUrl,
  linkingEnabled,
  bulkCollapse,
  collapseState,
  outline,
  rightRail,
  eventNodeContext,
  className,
}) => {
  // Group props destructure to locals immediately: the group objects are
  // typically fresh literals at call sites, but the values inside keep the
  // caller's identity — hooks below depend on the values, never the groups.
  const {
    selection: timelineSelection,
    active: activeTimeline,
    serverTimelines,
    markerConfig: markerConfigOverride,
    agentConfig: agentConfigOverride,
    showSwimlanes: showSwimlanesOption = "auto",
    onMarkerNavigate,
    onScrollToTop,
  } = timeline ?? {};
  const { eventId: initialEventId, messageId: initialMessageId } =
    deepLink ?? {};
  const {
    hidden: headroomHidden,
    onSetHidden: onHeadroomSetHidden,
    onResetAnchor: onHeadroomResetAnchor,
  } = headroom ?? {};
  const {
    text: emptyText = "No events match the current filter",
    busy: emptyBusy,
  } = empty ?? {};
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
  // Swimlane header
  // ---------------------------------------------------------------------------

  const hiddenUtilityCount = useMemo(
    () => countUtilitySpans(transcriptTimeline.timeline.root),
    [transcriptTimeline.timeline.root]
  );

  const swimlaneHeader = useSwimlaneHeader({
    scrollRef,
    onScrollToTop,
    onHeadroomResetAnchor,
    timelineConfig,
    hiddenUtilityCount,
    minimap,
    multiTimeline,
    views,
  });

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
    onHeadroomResetAnchor,
  });

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

  const hasMatchingEvents = eventNodes.length > 0;

  // ---------------------------------------------------------------------------
  // Headroom reset anchor
  // ---------------------------------------------------------------------------

  const handleLayoutShift = useCallback(
    (debounce?: boolean) => onHeadroomResetAnchor?.(debounce),
    [onHeadroomResetAnchor]
  );

  // The rail panel's scroll container is written by RailDock and read only by
  // the wheel coupling below — no caller sees it, so the layout owns the ref.
  const railPanelScrollRef = useRef<HTMLDivElement | null>(null);

  // The rail panel pins directly below the toolbar (offsetTop), alongside
  // the timeline; the outline pins below the swimlanes (effectiveOffsetTop).
  // Each needs its own sticky-detection threshold. The remount keys re-attach
  // listeners when collapse state changes (the scroll elements may have
  // unmounted/remounted via the conditional render).
  useSidebarScrollCoupling({
    mainScrollRef: scrollRef,
    sidebars: [
      {
        scrollRef: outline?.scrollRef,
        stickyTop: effectiveOffsetTop,
        remountKey: outline?.collapsed ?? null,
      },
      {
        scrollRef: railPanelScrollRef,
        stickyTop: offsetTop,
        remountKey: rightRail?.panel != null,
      },
    ],
  });

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
                <OutlineSidebar
                  outline={outline}
                  isCollapsed={isOutlineCollapsed}
                  hasNodes={outlineHasNodes}
                  onHasNodesChange={onOutlineHasNodesChange}
                  eventNodes={eventNodes}
                  defaultCollapsedIds={defaultCollapsedIds}
                  scrollRef={scrollRef}
                  running={running}
                  backfilling={backfilling}
                  agentName={
                    outline.name ??
                    (showSwimlanes ? selectedRowName : undefined)
                  }
                  offsetTop={effectiveOffsetTop}
                  collapseState={collapseState}
                  getEventUrl={getEventUrl}
                />
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
              panelScrollRef={railPanelScrollRef}
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
