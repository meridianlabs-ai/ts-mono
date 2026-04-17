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
import { Link, useNavigate } from "react-router-dom";

import type {
  Score,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";
import {
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  TranscriptLayout,
  type TranscriptCollapseState,
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
import { useMakeCiteUrl } from "../scans/scanReferences";
import { SampleScansSidebar } from "../scans/SampleScansSidebar";

interface TranscriptPanelProps {
  id: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  offsetTop?: number;

  // The sample
  sampleId?: string | number;
  sampleEpoch?: number;
  running?: boolean;

  // The transcript data
  events: Events;
  timelines?: ServerTimeline[];
  scans?: Record<string, Score> | null;

  initialEventId?: string | null;
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
    timelines: serverTimelines,
    scans: scores,
    sampleId,
    sampleEpoch,
  } = props;

  // Cite-URL builder for the scoring sidebar. TranscriptPanel already has
  // events / sample identifiers, so construct the URL fn here and hand it
  // down — SampleScansSidebar doesn't need to know about navigation.
  const makeCiteUrl = useMakeCiteUrl({ events, sampleId, sampleEpoch });

  // ---------------------------------------------------------------------------
  // Event type filtering
  // ---------------------------------------------------------------------------

  const filteredEventTypes = useStore(
    (state) => state.sample.eventFilter.filteredTypes
  );

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

  const collapseState = useMemo<TranscriptCollapseState>(() => {
    const events = collapsedEvents ?? undefined;
    return {
      transcript: events?.[kTranscriptCollapseScope],
      outline: events?.[kTranscriptOutlineCollapseScope],
      onCollapseTranscript: (nodeId: string, collapsed: boolean) =>
        collapseEventStore(kTranscriptCollapseScope, nodeId, collapsed),
      onCollapseOutline: (nodeId: string, collapsed: boolean) =>
        collapseEventStore(kTranscriptOutlineCollapseScope, nodeId, collapsed),
      onSetTranscriptCollapsed: (ids: Record<string, boolean>) =>
        setCollapsedEventsStore(kTranscriptCollapseScope, ids),
      onSetOutlineCollapsed: (ids: Record<string, boolean>) =>
        setCollapsedEventsStore(kTranscriptOutlineCollapseScope, ids),
    };
  }, [collapsedEvents, collapseEventStore, setCollapsedEventsStore]);

  // Bulk collapse mode: "collapsed" | "expanded" | null
  // Map to the layout's bulkCollapse?: "collapse" | "expand" prop
  const collapsedMode = useStore((state) => state.sample.collapsedMode);
  const bulkCollapse = useMemo<"collapse" | "expand" | undefined>(() => {
    if (collapsedMode === "collapsed") return "collapse";
    if (collapsedMode === "expanded") return "expand";
    // collapsedMode === null: apply defaults if no collapsedEvents yet
    if (!collapsedEvents) return "expand";
    return undefined;
  }, [collapsedMode, collapsedEvents]);

  // ---------------------------------------------------------------------------
  // Headroom: collapse swimlanes on scroll-down, expand on scroll-up
  // ---------------------------------------------------------------------------

  // Refs to the outline / rightPane sticky scroll containers so their
  // internal scrolling also participates in headroom-direction detection.
  const outlineScrollRef = useRef<HTMLDivElement | null>(null);
  const rightPaneScrollRef = useRef<HTMLDivElement | null>(null);

  const scrollRefs = useMemo(
    () => [scrollRef, outlineScrollRef, rightPaneScrollRef],
    [scrollRef]
  );

  const { hidden: headroomHidden, resetAnchor: headroomResetAnchor } =
    useScrollDirection(scrollRefs);

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

  // ---------------------------------------------------------------------------
  // Scores sidebar collapse state
  // ---------------------------------------------------------------------------

  const scoresKey = `transcript-scores-${logPath || "na"}`;
  const scoresCollapsedRaw = useStore((state) => {
    const bag = state.app.propertyBags["collapse-state-scope"];
    return bag?.[scoresKey] as boolean | undefined;
  });
  const setScoresCollapsed = useCallback(
    (value: boolean) => {
      setPropertyValue("collapse-state-scope", scoresKey, value);
    },
    [setPropertyValue, scoresKey]
  );
  const scoresCollapsed = scoresCollapsedRaw ?? false;

  // Scores sidebar width (global preference, persisted across samples).
  const scoresWidthRaw = useStore((state) => {
    const bag = state.app.propertyBags["sidebar-widths"];
    return bag?.["scores"] as number | undefined;
  });
  const scoresWidth = scoresWidthRaw ?? 380;
  const setScoresWidth = useCallback(
    (value: number) => {
      setPropertyValue("sidebar-widths", "scores", value);
    },
    [setPropertyValue]
  );

  const hasScores = !!scores && Object.keys(scores).length > 0;

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
      outlineScrollRef={outlineScrollRef}
      rightPaneScrollRef={rightPaneScrollRef}
      outline={{
        collapsed: outlineCollapsed,
        onCollapsedChange: setOutlineCollapsed,
        toggleIcon: ApplicationIcons.sidebar,
        toggleTitle: outlineCollapsed
          ? "Show transcript outline"
          : "Hide transcript outline",
        renderLink,
        selectedId: selectedOutlineId,
        setSelectedId: setSelectedOutlineId,
      }}
      rightPane={
        hasScores && scores
          ? {
              collapsed: scoresCollapsed,
              onCollapsedChange: setScoresCollapsed,
              toggleIcon: ApplicationIcons.scoringSidebar,
              toggleTitle: scoresCollapsed
                ? "Show scan results"
                : "Hide scan results",
              label: "scans",
              width: scoresWidth,
              onWidthChange: setScoresWidth,
              content: (
                <SampleScansSidebar
                  scores={scores}
                  makeCiteUrl={makeCiteUrl}
                />
              ),
            }
          : undefined
      }
      emptyText={
        filteredEventTypes.length > 0
          ? "The currently applied filter hides all events."
          : undefined
      }
    />
  );
});
