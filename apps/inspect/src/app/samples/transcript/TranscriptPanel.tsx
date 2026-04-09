import clsx from "clsx";
import {
  CSSProperties,
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
import { Link, useNavigate } from "react-router-dom";
import { VirtuosoHandle } from "react-virtuoso";

import type { Timeline as ServerTimeline } from "@tsmono/inspect-common/types";
import {
  AgentCardView,
  buildSpanSelectKeys,
  computeTurnMap,
  EventNode,
  flatTree as flattenTree,
  hasSpans,
  kSandboxSignalName,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
  TimelineSelectContext,
  TimelineSwimLanes,
  TranscriptOutline,
  TranscriptVirtualList,
  useEventNodes,
  useTimelineConfig,
  useTranscriptTimeline,
  type TimelineSpan,
} from "@tsmono/inspect-components/transcript";
import {
  NoContentsPanel,
  StickyScroll,
  StickyScrollProvider,
} from "@tsmono/react/components";
import {
  useCollapsedState,
  useListKeyboardNavigation,
  useScrollDirection,
  useScrubberProgress,
} from "@tsmono/react/hooks";

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

import styles from "./TranscriptPanel.module.css";

interface TranscriptPanelProps {
  id: string;
  events: Events;
  scrollRef: RefObject<HTMLDivElement | null>;
  running?: boolean;
  initialEventId?: string | null;
  topOffset?: number;
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
    topOffset,
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
  // Timeline config (persistent user preferences for markers, branches, etc.)
  // ---------------------------------------------------------------------------

  const timelineConfig = useTimelineConfig();

  // ---------------------------------------------------------------------------
  // Timeline pipeline (only active when timelines are provided)
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

  const timelineProps = useMemo(
    () => ({ selected: timelineSelected, onSelect: setTimelineSelected }),
    [timelineSelected, setTimelineSelected]
  );
  const activeTimelineProps = useMemo(
    () => ({
      activeIndex: activeTimelineIndex,
      onActiveChange: setActiveTimelineIndex,
    }),
    [activeTimelineIndex, setActiveTimelineIndex]
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
    timelines: builtTimelines,
    activeTimelineIndex: resolvedActiveIndex,
    setActiveTimeline,
    regionCounts,
    branchScrollTarget,
    highlightedKeys,
    outlineAgentName,
  } = useTranscriptTimeline(
    filteredEvents,
    timelineConfig.markerConfig,
    timelineConfig.agentConfig,
    serverTimelines,
    { timelineProps, activeTimelineProps }
  );

  const showSwimlanes =
    hasTimeline || regionCounts.size > 0 || builtTimelines.length > 1;

  // When timeline is active, use the selected (scoped) events;
  // otherwise fall back to the full filtered set.
  const eventsForNodes = showSwimlanes ? selectedEvents : filteredEvents;

  // ---------------------------------------------------------------------------
  // Event nodes
  // ---------------------------------------------------------------------------

  const { eventNodes, defaultCollapsedIds } = useEventNodes(
    eventsForNodes,
    running === true,
    showSwimlanes ? sourceSpans : undefined
  );

  // ---------------------------------------------------------------------------
  // Collapse state
  // ---------------------------------------------------------------------------

  const collapsedEvents = useStore((state) => state.sample.collapsedEvents);
  const setCollapsedEvents = useStore(
    (state) => state.sampleActions.setCollapsedEvents
  );
  const collapseEvent = useStore((state) => state.sampleActions.collapseEvent);

  const onCollapse = useCallback(
    (nodeId: string, collapsed: boolean) => {
      collapseEvent(kTranscriptCollapseScope, nodeId, collapsed);
    },
    [collapseEvent]
  );

  const getCollapsed = useCallback(
    (nodeId: string) => {
      return collapsedEvents?.[kTranscriptCollapseScope]?.[nodeId] === true;
    },
    [collapsedEvents]
  );

  const flattenedNodes = useMemo(() => {
    return flattenTree(
      eventNodes,
      (collapsedEvents
        ? collapsedEvents[kTranscriptCollapseScope]
        : undefined) || defaultCollapsedIds
    );
  }, [eventNodes, collapsedEvents, defaultCollapsedIds]);

  // Compute filtered node list for the outline (shared between outline and turn computation)
  const outlineFilteredNodes = useMemo(() => {
    return flattenTree(
      eventNodes,
      (collapsedEvents
        ? collapsedEvents[kTranscriptOutlineCollapseScope]
        : undefined) || defaultCollapsedIds,
      [
        removeNodeVisitor("logger"),
        removeNodeVisitor("info"),
        removeNodeVisitor("state"),
        removeNodeVisitor("store"),
        removeNodeVisitor("approval"),
        removeNodeVisitor("input"),
        removeNodeVisitor("sandbox"),
        removeStepSpanNameVisitor(kSandboxSignalName),
        noScorerChildren(),
      ]
    );
  }, [eventNodes, collapsedEvents, defaultCollapsedIds]);

  const turnMap = useMemo(
    () => computeTurnMap(outlineFilteredNodes, flattenedNodes),
    [outlineFilteredNodes, flattenedNodes]
  );

  // ---------------------------------------------------------------------------
  // Collapse mode (bulk collapse/expand)
  // ---------------------------------------------------------------------------

  const collapsedMode = useStore((state) => state.sample.collapsedMode);

  useEffect(() => {
    if (events.length <= 0 || collapsedMode !== null) {
      return;
    }

    if (!collapsedEvents && Object.keys(defaultCollapsedIds).length > 0) {
      setCollapsedEvents(kTranscriptCollapseScope, defaultCollapsedIds);
    }
  }, [
    defaultCollapsedIds,
    collapsedEvents,
    setCollapsedEvents,
    events.length,
    collapsedMode,
  ]);

  const allNodesList = useMemo(() => {
    return flattenTree(eventNodes, null);
  }, [eventNodes]);

  useEffect(() => {
    if (events.length <= 0 || collapsedMode === null) {
      return;
    }

    const collapseIds: Record<string, boolean> = {};
    const isCollapsed = collapsedMode === "collapsed";

    allNodesList.forEach((node) => {
      if (
        node.event.uuid &&
        ((isCollapsed &&
          !hasSpans(node.children.map((child) => child.event))) ||
          !isCollapsed)
      ) {
        collapseIds[node.event.uuid] = collapsedMode === "collapsed";
      }
    });

    setCollapsedEvents(kTranscriptCollapseScope, collapseIds);
  }, [collapsedMode, events, allNodesList, setCollapsedEvents]);

  // ---------------------------------------------------------------------------
  // Outline collapse state
  // ---------------------------------------------------------------------------

  const { logPath } = useLogRouteParams();
  const [outlineCollapsed, setOutlineCollapsed] = useCollapsedState(
    `transcript-panel-${logPath || "na"}`,
    false
  );

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  const listHandle = useRef<VirtuosoHandle | null>(null);

  useListKeyboardNavigation({
    listHandle,
    scrollRef,
    itemCount: flattenedNodes.length,
  });

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
  // Scrubber: scroll progress for minimap scrubber
  // ---------------------------------------------------------------------------

  const [scrubberProgress, scrubTo] = useScrubberProgress(scrollRef);

  const handleScrub = useCallback(
    (progress: number) => {
      headroomResetAnchor(true);
      scrubTo(progress);
    },
    [headroomResetAnchor, scrubTo]
  );

  // ---------------------------------------------------------------------------
  // Sticky swimlane height tracking
  // ---------------------------------------------------------------------------

  const [stickySwimLaneHeight, setStickySwimLaneHeight] = useState(0);
  const [isSwimLaneSticky, setIsSwimLaneSticky] = useState(false);
  const swimLaneStickyContentRef = useRef<HTMLDivElement | null>(null);

  const handleSwimLaneStickyChange = useCallback((sticky: boolean) => {
    setIsSwimLaneSticky(sticky);
    if (!sticky) {
      setStickySwimLaneHeight(0);
    }
  }, []);

  useEffect(() => {
    const el = swimLaneStickyContentRef.current;
    if (!isSwimLaneSticky || !el) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setStickySwimLaneHeight(el.getBoundingClientRect().height);
    });
    observer.observe(el);
    setStickySwimLaneHeight(el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [isSwimLaneSticky]);

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
      setTimelineSelected(key.key);
    },
    [spanSelectKeys, setTimelineSelected]
  );

  // ---------------------------------------------------------------------------
  // Agent card rendering (for timeline-scoped events)
  // ---------------------------------------------------------------------------

  const renderAgentCard = useCallback(
    (node: EventNode, className?: string | string[]) => {
      const span = node.sourceSpan as TimelineSpan | undefined;
      if (!span) return null;
      return <AgentCardView span={span} className={className} />;
    },
    []
  );

  // Effective initial event ID (branch scroll target takes priority when set)
  const effectiveInitialEventId = initialEventId ?? branchScrollTarget ?? null;

  // Effective offset accounting for sticky swimlane height
  const effectiveOffsetTop = (topOffset ?? 0) + stickySwimLaneHeight;

  // ---------------------------------------------------------------------------
  // Outline callback props (wiring store to shared TranscriptOutline)
  // ---------------------------------------------------------------------------

  const selectedOutlineId = useStore((state) => state.sample.selectedOutlineId);
  const setSelectedOutlineId = useStore(
    (state) => state.sampleActions.setSelectedOutlineId
  );

  const getOutlineCollapsed = useCallback(
    (scope: string, nodeId: string) =>
      collapsedEvents?.[scope]?.[nodeId] === true,
    [collapsedEvents]
  );

  const onOutlineCollapse = useCallback(
    (scope: string, nodeId: string, collapsed: boolean) => {
      collapseEvent(scope, nodeId, collapsed);
    },
    [collapseEvent]
  );

  const getOutlineCollapsedEvents = useCallback(
    () =>
      collapsedEvents?.[kTranscriptOutlineCollapseScope] as
        | Record<string, boolean>
        | undefined,
    [collapsedEvents]
  );

  // Sync initial event ID to outline selection for deep-link navigation
  useEffect(() => {
    if (initialEventId) {
      setSelectedOutlineId(initialEventId);
    }
  }, [initialEventId, setSelectedOutlineId]);

  // Deep-link URL builder for outline rows
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

  if (sampleStatus === "loading" && flattenedNodes.length === 0) {
    return undefined;
  }

  if (flattenedNodes.length === 0) {
    const isCompletedFiltered =
      flattenedNodes.length === 0 && events.length > 0;
    const message = isCompletedFiltered
      ? "The currently applied filter hides all events."
      : eventsCleared
        ? "Transcript events were removed because this sample exceeds the browser's size limit. Use the Messages tab to view the conversation."
        : "No events to display.";
    return <NoContentsPanel text={message} />;
  } else {
    return (
      <TimelineSelectContext.Provider value={selectBySpanId}>
        <div className={styles.root}>
          {showSwimlanes && (
            <StickyScroll
              scrollRef={scrollRef}
              offsetTop={topOffset}
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
                    minimap: {
                      root: timelineData.root,
                      selection: minimapSelection,
                      mapping: rootTimeMapping,
                      scrubberProgress,
                      onScrub: handleScrub,
                    },
                    timelineConfig,
                    timelineSelector:
                      builtTimelines.length > 1
                        ? {
                            timelines: builtTimelines,
                            activeIndex: resolvedActiveIndex,
                            onSelect: setActiveTimeline,
                          }
                        : undefined,
                  }}
                  onMarkerNavigate={onMarkerNavigate}
                  isSticky={isSwimLaneSticky}
                  headroomCollapsed={!!headroomHidden && isSwimLaneSticky}
                  onLayoutShift={onHeadroomResetAnchor}
                  defaultCollapsed={hasTimeline ? false : undefined}
                  regionCounts={regionCounts}
                  highlightedKeys={highlightedKeys}
                />
              </div>
            </StickyScroll>
          )}
          <div
            className={clsx(
              styles.container,
              outlineCollapsed ? styles.collapsed : undefined
            )}
            style={
              showSwimlanes
                ? ({
                    "--outline-top": `${effectiveOffsetTop}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            <div className={styles.treeContainer}>
              <StickyScroll
                scrollRef={scrollRef}
                offsetTop={effectiveOffsetTop}
                className={styles.stickyOutline}
              >
                <TranscriptOutline
                  className={clsx(styles.outline)}
                  eventNodes={eventNodes}
                  defaultCollapsedIds={defaultCollapsedIds}
                  running={running}
                  scrollRef={scrollRef}
                  scrollTrackOffset={effectiveOffsetTop}
                  agentName={showSwimlanes ? outlineAgentName : undefined}
                  getCollapsed={getOutlineCollapsed}
                  setCollapsed={onOutlineCollapse}
                  getCollapsedEvents={getOutlineCollapsedEvents}
                  setCollapsedEvents={setCollapsedEvents}
                  selectedOutlineId={selectedOutlineId}
                  setSelectedOutlineId={setSelectedOutlineId}
                  getEventUrl={getEventUrl}
                  renderLink={renderLink}
                />
                <div
                  className={styles.outlineToggle}
                  onClick={() => setOutlineCollapsed(!outlineCollapsed)}
                >
                  <i className={ApplicationIcons.sidebar} />
                </div>
              </StickyScroll>
            </div>

            <StickyScrollProvider value={scrollRef ?? null}>
              <div
                style={
                  {
                    "--inspect-event-panel-sticky-top": `${effectiveOffsetTop}px`,
                  } as CSSProperties
                }
              >
                <TranscriptVirtualList
                  id={id}
                  listHandle={listHandle}
                  eventNodes={flattenedNodes}
                  scrollRef={scrollRef}
                  running={running}
                  initialEventId={effectiveInitialEventId}
                  offsetTop={effectiveOffsetTop}
                  className={styles.listContainer}
                  turnMap={turnMap}
                  onCollapse={onCollapse}
                  getCollapsed={getCollapsed}
                  renderAgentCard={showSwimlanes ? renderAgentCard : undefined}
                />
              </div>
            </StickyScrollProvider>
          </div>
        </div>
      </TimelineSelectContext.Provider>
    );
  }
});
