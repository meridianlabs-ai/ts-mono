import {
  FC,
  memo,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Timeline as ServerTimeline } from "@tsmono/inspect-common/types";
import {
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  TranscriptLayout,
  type TranscriptCollapseState,
} from "@tsmono/inspect-components/transcript";
import { NoContentsPanel } from "@tsmono/react/components";
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

interface TranscriptPanelProps {
  id: string;
  events: Events;
  scrollRef: RefObject<HTMLDivElement | null>;
  running?: boolean;
  initialEventId?: string | null;
  offsetTop?: number;
  eventsCleared?: boolean;
  timelines?: ServerTimeline[];
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
    offsetTop,
    eventsCleared,
    timelines: serverTimelines,
  } = props;

  // ---------------------------------------------------------------------------
  // Event type filtering
  // ---------------------------------------------------------------------------

  const filteredEventTypes = useStore(
    (state) => state.sample.eventFilter.filteredTypes
  );

  const sampleStatus = useStore((state) => state.sample.sampleStatus);

  const filteredEvents = useMemo(() => {
    if (filteredEventTypes.length === 0) {
      return events;
    }
    return events.filter((event) => {
      return !filteredEventTypes.includes(event.event);
    });
  }, [events, filteredEventTypes]);

  // ---------------------------------------------------------------------------
  // Store-backed timeline selection adapters
  // ---------------------------------------------------------------------------

  const timelineSelected = useStore((state) => state.sample.timelineSelected);
  const setTimelineSelected = useStore(
    (state) => state.sampleActions.setTimelineSelected
  );
  const activeTimelineIndex = useStore(
    (state) => state.sample.activeTimelineIndex
  );
  const setActiveTimelineIndex = useStore(
    (state) => state.sampleActions.setActiveTimelineIndex
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

  const { hidden: headroomHidden, resetAnchor: headroomResetAnchor } =
    useScrollDirection(scrollRef);

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
  const logDir = useStore((state) => state.logs.logDir);

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

  const renderLink = useCallback(
    (url: string, children: ReactNode) => <Link to={url}>{children}</Link>,
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
      void navigate(url);
    },
    [getEventUrl, navigate, setTimelineSelected]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (sampleStatus === "loading" && events.length === 0) {
    return undefined;
  }

  if (events.length === 0) {
    const message = eventsCleared
      ? "Transcript events were removed because this sample exceeds the browser's size limit. Use the Messages tab to view the conversation."
      : "No events to display.";
    return <NoContentsPanel text={message} />;
  }

  return (
    <TranscriptLayout
      events={filteredEvents}
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
      listId={id}
      initialEventId={initialEventId}
      getEventUrl={getEventUrl}
      linkingEnabled={true}
      bulkCollapse={bulkCollapse}
      collapseState={collapseState}
      outline={{
        collapsed: outlineCollapsed,
        onCollapsedChange: setOutlineCollapsed,
        toggleIcon: ApplicationIcons.sidebar,
        renderLink,
        selectedId: selectedOutlineId,
        setSelectedId: setSelectedOutlineId,
      }}
      emptyText={
        filteredEventTypes.length > 0
          ? "The currently applied filter hides all events."
          : undefined
      }
    />
  );
});
