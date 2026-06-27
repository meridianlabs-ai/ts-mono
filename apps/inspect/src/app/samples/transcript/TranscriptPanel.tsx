import {
  FC,
  memo,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import type { Timeline as ServerTimeline } from "@tsmono/inspect-common/types";
import {
  clearDeepLinkParams,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  TranscriptLayout,
  type EventNodeContext,
  type SelectOptions,
  type TranscriptCollapseState,
  type TranscriptLayoutRightRailProps,
  type TranscriptViewNodesHandle,
} from "@tsmono/inspect-components/transcript";
import { useScrollDirection } from "@tsmono/react/hooks";

import { Events } from "../../../@types/extraInspect";
import { useStore } from "../../../state/store";
import { ApplicationIcons } from "../../appearance/icons";
import {
  makeLogsPath,
  sampleEventUrl,
  useLogOrSampleRouteParams,
  useLogRouteParams,
  useSampleUrlBuilder,
} from "../../routing/url";
import { useLogDir } from "../../server/useLogDir";

import { useTranscriptFilter } from "./hooks";

interface TranscriptPanelProps {
  id: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  offsetTop?: number;

  // The sample
  running?: boolean;

  // The transcript data
  events: Events;
  timelines?: ServerTimeline[];

  /** Extra event-node context (e.g. scan cite labels) merged by the layout. */
  eventNodeContext?: Partial<EventNodeContext>;

  /** Always-visible right rail + optional panel (Search / Scans). */
  rightRail?: TranscriptLayoutRightRailProps;
  rightRailPanelScrollRef?: RefObject<HTMLDivElement | null>;

  initialEventId?: string | null;
  initialMessageId?: string | null;
}

/**
 * Renders the Transcript Virtual List, with optional timeline swimlanes
 * when the sample provides timeline data.
 */
export const TranscriptPanel: FC<TranscriptPanelProps> = memo((props) => {
  const {
    id,
    scrollRef,
    events,
    running,
    initialEventId,
    initialMessageId,
    offsetTop,
    timelines: serverTimelines,
    eventNodeContext,
    rightRail,
    rightRailPanelScrollRef,
  } = props;

  // ---------------------------------------------------------------------------
  // Event type filtering
  // ---------------------------------------------------------------------------

  const filteredEventTypes = useStore(
    (state) => state.sample.eventFilter.filteredTypes
  );
  const { isDefaultFilter } = useTranscriptFilter();

  // ---------------------------------------------------------------------------
  // Store-backed timeline selection adapters
  // ---------------------------------------------------------------------------

  const timelineSelected = useStore((state) => state.sample.timelineSelected);
  const setTimelineSelectedStore = useStore(
    (state) => state.sampleActions.setTimelineSelected
  );
  const activeTimelineIndex = useStore(
    (state) => state.sample.activeTimelineIndex
  );
  const setActiveTimelineIndex = useStore(
    (state) => state.sampleActions.setActiveTimelineIndex
  );

  // Timeline selection is store-backed, but on a user-initiated row click
  // a stale URL `?event=` / `?message=` would otherwise win over the new
  // row's `branchScrollTarget`. Clear those (and reset scroll to top so
  // the post-mount imperative scroll has a clean origin) — but only when
  // this is a user click. Message-resolution-driven selection changes pass
  // `preserveDeepLink: true` because their imperative scroll still needs
  // the deep-link target.
  const [, setSearchParams] = useSearchParams();
  const setTimelineSelected = useCallback(
    (key: string | null, options?: SelectOptions) => {
      setTimelineSelectedStore(key);
      if (options?.preserveDeepLink) return;
      if (!options?.preserveScroll) {
        scrollRef.current?.scrollTo({ top: 0 });
      }
      setSearchParams(
        (prev) => clearDeepLinkParams(new URLSearchParams(prev)),
        { replace: true }
      );
    },
    [setTimelineSelectedStore, setSearchParams, scrollRef]
  );

  const timelineSelection = useMemo(
    () => ({ selected: timelineSelected, onSelect: setTimelineSelected }),
    [timelineSelected, setTimelineSelected]
  );
  const activeTimeline = useMemo(
    () => ({
      activeIndex: activeTimelineIndex,
      onActiveChange: setActiveTimelineIndex,
    }),
    [activeTimelineIndex, setActiveTimelineIndex]
  );

  // ---------------------------------------------------------------------------
  // Collapse state (from store)
  // ---------------------------------------------------------------------------

  const collapsedEvents = useStore((state) => state.sample.collapsedEvents);
  const setCollapsedEventsStore = useStore(
    (state) => state.sampleActions.setCollapsedEvents
  );
  const collapseEventStore = useStore(
    (state) => state.sampleActions.collapseEvent
  );

  const onCollapseTranscript = useCallback(
    (nodeId: string, collapsed: boolean) =>
      collapseEventStore(kTranscriptCollapseScope, nodeId, collapsed),
    [collapseEventStore]
  );
  const onCollapseOutline = useCallback(
    (nodeId: string, collapsed: boolean) =>
      collapseEventStore(kTranscriptOutlineCollapseScope, nodeId, collapsed),
    [collapseEventStore]
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

  const collapseState = useMemo<TranscriptCollapseState>(() => {
    const events = collapsedEvents ?? undefined;
    return {
      transcript: events?.[kTranscriptCollapseScope],
      outline: events?.[kTranscriptOutlineCollapseScope],
      onCollapseTranscript,
      onCollapseOutline,
      onSetTranscriptCollapsed,
      onSetOutlineCollapsed,
    };
  }, [
    collapsedEvents,
    onCollapseTranscript,
    onCollapseOutline,
    onSetTranscriptCollapsed,
    onSetOutlineCollapsed,
  ]);

  // Bulk collapse mode: "collapsed" | "expanded" | null
  // Map to the layout's bulkCollapse?: "collapse" | "expand" prop
  const collapsedMode = useStore((state) => state.sample.collapsedMode);
  const bulkCollapse = useMemo<"collapse" | "expand" | undefined>(() => {
    if (collapsedMode === "collapsed") return "collapse";
    if (collapsedMode === "expanded") return "expand";
    return undefined;
  }, [collapsedMode]);

  // ---------------------------------------------------------------------------
  // Headroom: collapse swimlanes on scroll-down, expand on scroll-up
  // ---------------------------------------------------------------------------

  // Ref to the outline sticky scroll container so its internal scrolling
  // also participates in headroom-direction detection.
  const outlineScrollRef = useRef<HTMLDivElement | null>(null);

  const scrollRefs = useMemo(() => [scrollRef, outlineScrollRef], [scrollRef]);

  const {
    hidden: headroomHidden,
    resetAnchor: headroomResetAnchor,
    setHidden: setHeadroomHidden,
  } = useScrollDirection(scrollRefs);

  const onHeadroomResetAnchor = useCallback(
    (debounce?: boolean) => headroomResetAnchor(debounce),
    [headroomResetAnchor]
  );

  // ---------------------------------------------------------------------------
  // Outline state
  // ---------------------------------------------------------------------------

  const { logPath } = useLogRouteParams();
  const outlineKey = `transcript-panel-${logPath || "na"}`;

  // Use component state for outline collapsed preference
  const outlineCollapsedRaw = useStore((state) => {
    const bag = state.app.propertyBags["collapse-state-scope"];
    return bag?.[outlineKey] as boolean | undefined;
  });
  const setPropertyValue = useStore(
    (state) => state.appActions.setPropertyValue
  );
  const setOutlineCollapsed = useCallback(
    (value: boolean) => {
      setPropertyValue("collapse-state-scope", outlineKey, value);
    },
    [setPropertyValue, outlineKey]
  );
  const outlineCollapsed = outlineCollapsedRaw ?? false;

  const selectedOutlineId = useStore((state) => state.sample.selectedOutlineId);
  const setSelectedOutlineId = useStore(
    (state) => state.sampleActions.setSelectedOutlineId
  );

  // Sync initial event ID to outline selection for deep-link navigation
  useEffect(() => {
    if (initialEventId) {
      setSelectedOutlineId(initialEventId);
    }
  }, [initialEventId, setSelectedOutlineId]);

  // ---------------------------------------------------------------------------
  // Deep-link URL builder
  // ---------------------------------------------------------------------------

  const builder = useSampleUrlBuilder();
  const {
    logPath: urlLogPath,
    id: urlSampleId,
    epoch: urlEpoch,
  } = useLogOrSampleRouteParams();
  const logFile = useStore((state) => state.logs.selectedLogFile);
  const logDir = useLogDir();

  const getEventUrl = useCallback(
    (eventId: string) => {
      let targetLogPath = urlLogPath;
      if (!targetLogPath && logFile) {
        targetLogPath = makeLogsPath(logFile, logDir);
      }
      if (!targetLogPath) return undefined;
      return sampleEventUrl(
        builder,
        eventId,
        targetLogPath,
        urlSampleId,
        urlEpoch
      );
    },
    [builder, urlLogPath, urlSampleId, urlEpoch, logFile, logDir]
  );

  // Outline link clicks are in-view navigation (jumping to an event in the
  // same transcript), so use `replace` to keep the back button clean.
  const renderLink = useCallback(
    (url: string, children: ReactNode) => (
      <Link to={url} replace>
        {children}
      </Link>
    ),
    []
  );

  // ---------------------------------------------------------------------------
  // Marker navigation (branch markers, error markers, etc.)
  // ---------------------------------------------------------------------------

  const navigate = useNavigate();

  const onMarkerNavigate = useCallback(
    (eventId: string, selectedKey?: string) => {
      const url = getEventUrl(eventId);
      if (!url) return;
      if (selectedKey) {
        setTimelineSelected(selectedKey);
      }
      void navigate(url, { replace: true });
    },
    [getEventUrl, navigate, setTimelineSelected]
  );

  // Outline navigation. Imperative scroll on every click — including
  // re-clicks of the already-selected item — so users can scroll away
  // and click the same outline row to jump back. The URL→scroll effect
  // in TranscriptViewNodes only fires when `event` actually changes,
  // so it can't handle a re-click of the same id by itself.
  const eventsListRef = useRef<TranscriptViewNodesHandle>(null);
  const onOutlineNavigate = useCallback((eventId: string) => {
    eventsListRef.current?.scrollToEvent(eventId);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <TranscriptLayout
      events={events}
      hiddenEventTypes={filteredEventTypes}
      running={running}
      scrollRef={scrollRef}
      offsetTop={offsetTop}
      timelineSelection={timelineSelection}
      activeTimeline={activeTimeline}
      serverTimelines={serverTimelines}
      showSwimlanes="auto"
      onMarkerNavigate={onMarkerNavigate}
      headroomHidden={headroomHidden}
      onHeadroomResetAnchor={onHeadroomResetAnchor}
      onHeadroomSetHidden={setHeadroomHidden}
      eventNodeContext={eventNodeContext}
      listId={id}
      initialEventId={initialEventId}
      initialMessageId={initialMessageId}
      getEventUrl={getEventUrl}
      linkingEnabled={true}
      bulkCollapse={bulkCollapse}
      collapseState={collapseState}
      eventsListRef={eventsListRef}
      outlineScrollRef={outlineScrollRef}
      rightRail={rightRail}
      rightRailPanelScrollRef={rightRailPanelScrollRef}
      outline={{
        collapsed: outlineCollapsed,
        onCollapsedChange: setOutlineCollapsed,
        toggleIcon: ApplicationIcons.sidebar,
        toggleTitle: outlineCollapsed
          ? "Show transcript outline"
          : "Hide transcript outline",
        renderLink,
        onNavigateToEvent: onOutlineNavigate,
        selectedId: selectedOutlineId,
        setSelectedId: setSelectedOutlineId,
      }}
      emptyText={
        running && isDefaultFilter
          ? "Sample is starting"
          : filteredEventTypes.length > 0
            ? "The currently applied filter hides all events."
            : undefined
      }
      emptyBusy={running && isDefaultFilter}
    />
  );
});

TranscriptPanel.displayName = "TranscriptPanel";
