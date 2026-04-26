import {
  FC,
  memo,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import type {
  Score,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";
import {
  clearDeepLinkParams,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  TranscriptLayout,
  type SelectOptions,
  type TranscriptCollapseState,
  type TranscriptViewNodesHandle,
} from "@tsmono/inspect-components/transcript";
import { useScrollDirection } from "@tsmono/react/hooks";
import {
  isScannerScore,
  readScannerReferences,
} from "@tsmono/scout-components/sentinels";

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
import { SampleScansSidebar } from "../scans/SampleScansSidebar";
import { useMakeCiteUrl } from "../scans/scanReferences";

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
    scans: allScores,
    sampleId,
    sampleEpoch,
  } = props;

  // Narrow to scanner-produced scores only. The sidebar is a scans sidebar,
  // not a scoring sidebar — non-scanner scores belong in the Scoring tab.
  const scores = useMemo(() => {
    if (!allScores) return null;
    const filtered: Record<string, Score> = {};
    for (const [key, score] of Object.entries(allScores)) {
      if (isScannerScore(score.metadata)) {
        filtered[key] = score;
      }
    }
    return filtered;
  }, [allScores]);

  // Cite-URL builder for the scoring sidebar. TranscriptPanel already has
  // events / sample identifiers, so construct the URL fn here and hand it
  // down — SampleScansSidebar doesn't need to know about navigation.
  const makeCiteUrl = useMakeCiteUrl({ sampleId, sampleEpoch });

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
      scrollRef.current?.scrollTo({ top: 0 });
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

  // ---------------------------------------------------------------------------
  // Selected scanner
  // ---------------------------------------------------------------------------

  const [selectedScanner, setSelectedScanner] = useState<string>("");

  useEffect(() => {
    const scanners = scores ? Object.keys(scores) : [];
    if (scanners.length === 0) {
      if (selectedScanner !== "") setSelectedScanner("");
    } else if (!scanners.includes(selectedScanner)) {
      setSelectedScanner(scanners[0]);
    }
  }, [scores, selectedScanner]);

  // ---------------------------------------------------------------------------
  // Message-label map for the currently-selected scanner.
  // ---------------------------------------------------------------------------

  const messageLabels = useMemo(() => {
    if (!hasScores || scoresCollapsed) return {};
    const score = selectedScanner ? scores?.[selectedScanner] : undefined;
    const refs = readScannerReferences(score?.metadata);
    const map: Record<string, string> = {};
    for (const r of refs) {
      if (r.type === "message" && r.id && r.cite) {
        map[r.id] = r.cite;
      }
    }
    return map;
  }, [hasScores, scoresCollapsed, scores, selectedScanner]);

  const eventNodeContext = useMemo(
    () =>
      Object.keys(messageLabels).length > 0 ? { messageLabels } : undefined,
    [messageLabels]
  );

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
      rightPaneScrollRef={rightPaneScrollRef}
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
                  events={events}
                  makeCiteUrl={makeCiteUrl}
                  selected={selectedScanner}
                  onSelectedChange={setSelectedScanner}
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
