import {
  CSSProperties,
  FC,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

import styles from "./TimelineEventsView.module.css";

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
  /** Optional sidebar rendered alongside the events view (e.g. a SearchPanel).
   *  When provided, the content is laid out alongside a resizable sidebar
   *  that stays pinned via position: sticky. */
  sidebar?: ReactNode;
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
  sidebar,
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

  const layout = (
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

  if (!sidebar) {
    return layout;
  }

  return (
    <SidebarLayout offsetTop={offsetTop} sidebar={sidebar}>
      {layout}
    </SidebarLayout>
  );
};

// =============================================================================
// SidebarLayout
// =============================================================================
//
// Lays out the transcript body alongside a sidebar, with a draggable handle
// between them. The sidebar uses `position: sticky` so the outer scroll
// container (the transcript container) drives scrolling for the main pane,
// while the sidebar stays pinned below the tab bar. The handle tracks mouse
// drag to resize the sidebar's column width.

const kSidebarMinWidth = 280;
const kSidebarMaxWidth = 800;
const kSidebarDefaultWidth = 380;

interface SidebarLayoutProps {
  offsetTop: number;
  sidebar: ReactNode;
  children: ReactNode;
}

const SidebarLayout: FC<SidebarLayoutProps> = ({
  offsetTop,
  sidebar,
  children,
}) => {
  const [width, setWidth] = useState(kSidebarDefaultWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const onHandleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = Math.max(
        kSidebarMinWidth,
        Math.min(kSidebarMaxWidth, rect.right - e.clientX)
      );
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.sidebarLayout}
      style={
        {
          "--sidebar-top": `${offsetTop}px`,
          "--sidebar-width": `${width}px`,
        } as CSSProperties
      }
    >
      <div className={styles.sidebarMain}>{children}</div>
      <div
        className={styles.sidebarHandle}
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onHandleMouseDown}
      />
      <div className={styles.sidebar}>{sidebar}</div>
    </div>
  );
};
