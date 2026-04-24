import { FC, RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import type { Event } from "@tsmono/inspect-common/types";
import {
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  TranscriptLayout,
  useTimelinesArray,
  type MarkerConfig,
  type TranscriptCollapseState,
  type TranscriptViewNodesHandle,
} from "@tsmono/inspect-components/transcript";
import { useProperty } from "@tsmono/react/hooks";

import { ApplicationIcons } from "../../../icons";
import { useStore } from "../../../state/store";
import type { ServerTimeline } from "../../../types/api-types";
import { useActiveTimelineSearchParams } from "../hooks/useActiveTimeline";
import type { TimelineOptions } from "../hooks/useTimeline";
import { useTimelineSearchParams } from "../hooks/useTimeline";

// =============================================================================
// Types
// =============================================================================

interface TimelineEventsViewProps {
  /** Raw events to display. Runs the full timeline pipeline internally. */
  events: Event[];
  /** Scroll container for StickyScroll and virtual list. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Base offset for sticky positioning (e.g. tab bar height). Default: 0. */
  offsetTop?: number;
  /** Deep-link to a specific event on mount. */
  initialEventId?: string | null;
  /** Deep-link to a message ID, resolved to the best matching event. */
  initialMessageId?: string | null;
  /** Initial outline state when no persistent preference exists. Default: false (collapsed). */
  defaultOutlineExpanded?: boolean;
  /** Unique ID for the virtual list. */
  id: string;
  /** Bulk collapse/expand of all collapsible events. Omit for no-op. */
  bulkCollapse?: "collapse" | "expand";
  /** Called when a marker (error, compaction) is clicked on the swimlane.
   *  Optional `selectedKey` requests the bar be selected atomically with navigation. */
  onMarkerNavigate?: (eventId: string, selectedKey?: string) => void;
  /** Controls which marker kinds are shown and at what depth. */
  markerConfig?: MarkerConfig;
  /** Controls swimlane visibility. `"auto"` shows when data has child spans. Default: `"auto"`. */
  timeline?: true | false | "auto";
  /** Controls which agents are included in the timeline. */
  agentConfig?: TimelineOptions;
  /** Server-provided timelines (used when available instead of building from events). */
  timelines?: ServerTimeline[];
  /** Headroom direction signal: true = scrolling down (hide). */
  headroomHidden?: boolean;
  /** Reset the headroom anchor before a layout shift or programmatic scroll.
   *  Pass `true` to debounce (keeps lock alive while scrolling continues). */
  onHeadroomResetAnchor?: (debounce?: boolean) => void;
  /** Callback to generate a full deep-link URL for an event. */
  getEventUrl?: (eventId: string) => string | undefined;
  /** Whether deep-link copy buttons are enabled. */
  linkingEnabled?: boolean;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const TimelineEventsView: FC<TimelineEventsViewProps> = ({
  events,
  scrollRef,
  offsetTop = 0,
  initialEventId,
  initialMessageId,
  defaultOutlineExpanded = false,
  id,
  bulkCollapse,
  onMarkerNavigate,
  markerConfig,
  timeline: timelineProp = "auto",
  agentConfig,
  timelines: serverTimelines,
  headroomHidden,
  onHeadroomResetAnchor,
  getEventUrl,
  linkingEnabled,
  className,
}) => {
  // ---------------------------------------------------------------------------
  // URL-param-backed selection adapters
  // ---------------------------------------------------------------------------

  const timelineSelection = useTimelineSearchParams();

  const timelinesArray = useTimelinesArray(events, serverTimelines);
  const activeTimeline = useActiveTimelineSearchParams(timelinesArray);

  // ---------------------------------------------------------------------------
  // Store-backed collapse state
  // ---------------------------------------------------------------------------

  const collapsedEvents = useStore((state) => state.transcriptCollapsedEvents);
  const setCollapsedEventStore = useStore(
    (state) => state.setTranscriptCollapsedEvent
  );
  const setCollapsedEventsStore = useStore(
    (state) => state.setTranscriptCollapsedEvents
  );

  const onCollapseTranscript = useCallback(
    (nodeId: string, collapsed: boolean) =>
      setCollapsedEventStore(kTranscriptCollapseScope, nodeId, collapsed),
    [setCollapsedEventStore]
  );
  const onCollapseOutline = useCallback(
    (nodeId: string, collapsed: boolean) =>
      setCollapsedEventStore(
        kTranscriptOutlineCollapseScope,
        nodeId,
        collapsed
      ),
    [setCollapsedEventStore]
  );
  const onSetTranscriptCollapsed = useCallback(
    (ids: Record<string, boolean>) =>
      setCollapsedEventsStore(kTranscriptCollapseScope, ids),
    [setCollapsedEventsStore]
  );
  const onSetOutlineCollapsed = useCallback(
    (ids: Record<string, boolean>) =>
      setCollapsedEventsStore(kTranscriptOutlineCollapseScope, ids),
    [setCollapsedEventsStore]
  );

  const collapseState = useMemo<TranscriptCollapseState>(
    () => ({
      transcript: collapsedEvents[kTranscriptCollapseScope],
      outline: collapsedEvents[kTranscriptOutlineCollapseScope],
      onCollapseTranscript,
      onCollapseOutline,
      onSetTranscriptCollapsed,
      onSetOutlineCollapsed,
    }),
    [
      collapsedEvents,
      onCollapseTranscript,
      onCollapseOutline,
      onSetTranscriptCollapsed,
      onSetOutlineCollapsed,
    ]
  );

  // ---------------------------------------------------------------------------
  // Outline state (persistent user preference)
  // ---------------------------------------------------------------------------

  const [outlineCollapsed, setOutlineCollapsed] = useProperty<boolean>(
    "timelineEvents",
    "outlineCollapsed",
    { defaultValue: !defaultOutlineExpanded }
  );
  const userOutlineCollapsed = outlineCollapsed ?? !defaultOutlineExpanded;

  const selectedOutlineId = useStore((state) => state.transcriptOutlineId);
  const setSelectedOutlineId = useStore(
    (state) => state.setTranscriptOutlineId
  );
  const clearTranscriptOutlineId = useStore(
    (state) => state.clearTranscriptOutlineId
  );

  // Clean up outline ID on unmount
  useEffect(() => {
    return () => {
      clearTranscriptOutlineId();
    };
  }, [clearTranscriptOutlineId]);

  // ---------------------------------------------------------------------------
  // Outline navigation
  // ---------------------------------------------------------------------------

  const eventsListRef = useRef<TranscriptViewNodesHandle>(null);
  const handleOutlineNavigate = useCallback(
    (eventId: string) => {
      onHeadroomResetAnchor?.(true);
      eventsListRef.current?.scrollToEvent(eventId);
    },
    [onHeadroomResetAnchor]
  );

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <TranscriptLayout
      events={events}
      scrollRef={scrollRef}
      offsetTop={offsetTop}
      timelineSelection={timelineSelection}
      activeTimeline={activeTimeline}
      serverTimelines={serverTimelines}
      markerConfig={markerConfig}
      agentConfig={agentConfig}
      showSwimlanes={timelineProp}
      onMarkerNavigate={onMarkerNavigate}
      onScrollToTop={scrollToTop}
      headroomHidden={headroomHidden}
      onHeadroomResetAnchor={onHeadroomResetAnchor}
      listId={id}
      initialEventId={initialEventId}
      initialMessageId={initialMessageId}
      eventsListRef={eventsListRef}
      getEventUrl={getEventUrl}
      linkingEnabled={linkingEnabled}
      bulkCollapse={bulkCollapse}
      collapseState={collapseState}
      outline={{
        collapsed: userOutlineCollapsed,
        onCollapsedChange: setOutlineCollapsed,
        toggleIcon: ApplicationIcons.sidebar,
        onNavigateToEvent: handleOutlineNavigate,
        selectedId: selectedOutlineId,
        setSelectedId: setSelectedOutlineId,
      }}
      className={className}
    />
  );
};
