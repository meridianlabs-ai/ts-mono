import { FC, RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import type { Event } from "@tsmono/inspect-common/types";
import {
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  TranscriptLayout,
  useTimelinesArray,
  useTranscriptHost,
  type EventNodeContext,
  type MarkerConfig,
  type TranscriptCollapseState,
  type TranscriptLayoutRightRailProps,
  type TranscriptSelection,
  type TranscriptViewNodesHandle,
} from "@tsmono/inspect-components/transcript";
import { useProperty } from "@tsmono/react/hooks";

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
  /** Event types hidden from the rendered list. Applied inside the timeline
   *  pipeline (not by pre-filtering `events`) so structural events like
   *  anchors still resolve fork points. */
  hiddenEventTypes?: readonly string[];
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
  /** Controls which marker kinds are shown and at what depth. */
  markerConfig?: MarkerConfig;
  /** Controls swimlane visibility. `"auto"` shows when data has child spans. Default: `"auto"`. */
  timeline?: true | false | "auto";
  /** Controls which agents are included in the timeline. */
  agentConfig?: TimelineOptions;
  /** Server-provided timelines (used when available instead of building from events). */
  timelines?: ServerTimeline[];
  /** Headroom direction signal: true = scrolling down (hide). The headroom's
   *  setters, deep-link URLs and navigation come from the TranscriptHost the
   *  mounting surface provides. */
  headroomHidden?: boolean;
  /** Per-message labels rendered in model-call message gutters. */
  messageLabels?: Record<string, string>;
  /** Per-event labels rendered beside transcript event rows. */
  eventLabels?: Record<string, string>;
  /** Optional right-side activity rail + resizable panel. */
  rightRail?: TranscriptLayoutRightRailProps;
  /** Evidence selection; present only while selection mode is on. */
  selection?: TranscriptSelection;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const TimelineEventsView: FC<TimelineEventsViewProps> = ({
  events,
  hiddenEventTypes,
  scrollRef,
  offsetTop = 0,
  initialEventId,
  initialMessageId,
  defaultOutlineExpanded = false,
  id,
  bulkCollapse,
  markerConfig,
  timeline: timelineProp = "auto",
  agentConfig,
  timelines: serverTimelines,
  headroomHidden,
  messageLabels,
  eventLabels,
  rightRail,
  selection,
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
  // While find-in-page is open its keys (j/k/g...) must reach the find box,
  // not navigate turns — same suppression inspect wires via showFind.
  const showFind = useStore((state) => state.showFind);

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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const userOutlineCollapsed = outlineCollapsed ?? !defaultOutlineExpanded;

  const selectedOutlineId = useStore((state) => state.transcriptOutlineId);
  const setSelectedOutlineId = useStore(
    (state) => state.setTranscriptOutlineId
  );
  const clearTranscriptOutlineId = useStore(
    (state) => state.clearTranscriptOutlineId
  );

  // Clean up outline ID on unmount
  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    return () => {
      clearTranscriptOutlineId();
    };
  }, [clearTranscriptOutlineId]);

  // ---------------------------------------------------------------------------
  // Outline navigation
  // ---------------------------------------------------------------------------

  const eventsListRef = useRef<TranscriptViewNodesHandle>(null);
  const onHeadroomResetAnchor = useTranscriptHost().headroom?.resetAnchor;
  const handleOutlineNavigate = useCallback(
    (eventId: string) => {
      onHeadroomResetAnchor?.(true);
      eventsListRef.current?.scrollToEvent(eventId);
    },
    [onHeadroomResetAnchor]
  );

  const eventNodeContext = useMemo<
    Partial<EventNodeContext> | undefined
  >(() => {
    const hasMessageLabels =
      messageLabels && Object.keys(messageLabels).length > 0;
    const hasEventLabels = eventLabels && Object.keys(eventLabels).length > 0;

    if (!hasMessageLabels && !hasEventLabels) return undefined;

    return {
      ...(hasMessageLabels ? { messageLabels } : {}),
      ...(hasEventLabels ? { eventLabels } : {}),
    };
  }, [messageLabels, eventLabels]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <TranscriptLayout
      events={events}
      hiddenEventTypes={hiddenEventTypes}
      scrollRef={scrollRef}
      offsetTop={offsetTop}
      timeline={{
        selection: timelineSelection,
        active: activeTimeline,
        serverTimelines,
        markerConfig,
        agentConfig,
        showSwimlanes: timelineProp,
      }}
      headroomHidden={headroomHidden}
      listId={id}
      deepLink={{ eventId: initialEventId, messageId: initialMessageId }}
      eventsListRef={eventsListRef}
      keyboardNavDisabled={showFind}
      eventNodeContext={eventNodeContext}
      bulkCollapse={bulkCollapse}
      collapseState={collapseState}
      outline={{
        collapsed: userOutlineCollapsed,
        onCollapsedChange: setOutlineCollapsed,
        onNavigateToEvent: handleOutlineNavigate,
        selectedId: selectedOutlineId,
        setSelectedId: setSelectedOutlineId,
      }}
      rightRail={rightRail}
      selection={selection}
      className={className}
    />
  );
};
