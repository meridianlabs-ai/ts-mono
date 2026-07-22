import { useVirtualizer } from "@tanstack/react-virtual";
import {
  FC,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getSelectedSpans,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  spanHasBranches,
  TimelineSwimLanes,
  TranscriptOutline,
  useTimelineConfig,
  useTimelinesArray,
  useTranscriptTimeline,
} from "@tsmono/inspect-components/transcript";

import {
  defaultCollapsedSpanIds,
  syntheticEventsFromSkeleton,
  type ChunkedSample,
} from "../../../../log_data";
import { useStore } from "../../../../state/store";

import { ChunkedRowView, rowNodeId } from "./ChunkedRowView";
import styles from "./ChunkedTranscriptPanel.module.css";
import { outlineViewTree } from "./mainViewOutline";
import { useChunkedRows } from "./useChunkedRows";

interface ChunkedTranscriptPanelProps {
  id: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  offsetTop?: number;
  chunked: ChunkedSample;
}

/**
 * The transcript for a chunked-shape sample: a row-window list model over
 * the RowSpace (the forked seam named in design/large-samples.md — shared
 * per-event row renderers, second window model) plus the legacy timeline
 * presentation layer (swimlanes + main-view outline) fed by a synthetic
 * event stream reconstructed from the skeleton. Rows materialize as they
 * scroll into view; everything above the data layer is estimate-then-correct
 * with ordinal re-anchoring.
 *
 * Divergence from the legacy panel: swimlane/outline selection scrolls the
 * body to the selected span rather than re-scoping the body to that view —
 * the body renders the raw event tree (main-view body is a flagged spec
 * follow-up).
 */
export const ChunkedTranscriptPanel: FC<ChunkedTranscriptPanelProps> = ({
  id,
  scrollRef,
  offsetTop,
  chunked,
}) => {
  const hiddenTypes = useStore(
    (state) => state.sample.eventFilter.filteredTypes
  );
  const collapsedOverrides = useStore(
    (state) => state.sample.collapsedEvents?.[kTranscriptCollapseScope]
  );
  const collapseEvent = useStore((state) => state.sampleActions.collapseEvent);

  const defaultCollapsed = useMemo(
    () => defaultCollapsedSpanIds(chunked.skeleton),
    [chunked]
  );
  const rows = useChunkedRows(
    chunked,
    collapsedOverrides,
    defaultCollapsed,
    hiddenTypes
  );

  // ---------------------------------------------------------------------------
  // Timeline layer (legacy pipeline over the synthetic skeleton stream)
  // ---------------------------------------------------------------------------

  const synth = useMemo(
    () => syntheticEventsFromSkeleton(chunked.skeleton),
    [chunked]
  );
  // TranscriptLayout.eventsForTimeline: anchors exempt from the type filter
  const eventsForTimeline = useMemo(
    () =>
      synth.events.filter(
        (e) => e.event === "anchor" || !hiddenTypes.includes(e.event)
      ),
    [synth, hiddenTypes]
  );

  const timelinesForBranchDetection = useTimelinesArray(eventsForTimeline);
  const branchesPresent = useMemo(
    () => timelinesForBranchDetection.some((tl) => spanHasBranches(tl.root)),
    [timelinesForBranchDetection]
  );
  const timelineConfig = useTimelineConfig({ branchesPresent });

  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const timelineSelection = useMemo(
    () => ({
      selected: selectedRow,
      onSelect: (key: string | null) => setSelectedRow(key),
    }),
    [selectedRow]
  );

  const {
    state: timelineState,
    layouts: timelineLayouts,
    timeline: timelineData,
    rootTimeMapping,
    selectedEvents,
    sourceSpans,
    minimapSelection,
    hasTimeline,
    hasAgentTimeline,
    regionCounts,
    highlightedKeys,
    selectedRowName,
  } = useTranscriptTimeline({
    events: eventsForTimeline,
    markerConfig: timelineConfig.markerConfig,
    timelineOptions: timelineConfig.agentConfig,
    timelineProps: timelineSelection,
  });

  const outlineTree = useMemo(
    () => outlineViewTree(selectedEvents, sourceSpans, hiddenTypes),
    [selectedEvents, sourceSpans, hiddenTypes]
  );

  const outlineCollapsed = useStore(
    (state) => state.sample.collapsedEvents?.[kTranscriptOutlineCollapseScope]
  );
  const setCollapsedEventsStore = useStore(
    (state) => state.sampleActions.setCollapsedEvents
  );
  const getOutlineCollapsed = useCallback(
    (nodeId: string) => outlineCollapsed?.[nodeId] === true,
    [outlineCollapsed]
  );
  const setOutlineCollapsed = useCallback(
    (nodeId: string, collapsed: boolean) =>
      collapseEvent(kTranscriptOutlineCollapseScope, nodeId, collapsed),
    [collapseEvent]
  );
  const setOutlineCollapsedEvents = useCallback(
    (ids: Record<string, boolean>) =>
      setCollapsedEventsStore(kTranscriptOutlineCollapseScope, ids),
    [setCollapsedEventsStore]
  );

  // TranscriptLayout's auto default: collapse when there's no agent
  // sub-structure to drill into.
  const swimlanesDefaultCollapsed = hasTimeline ? !hasAgentTimeline : true;

  const virtualizer = useVirtualizer({
    count: rows.total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    paddingStart: offsetTop,
    getItemKey: (index) => {
      const slot = rows.slotAt(index);
      return slot.kind === "row" ? rowNodeId(slot.row) : `ph-${index}`;
    },
  });

  // materialize the chunks under visible placeholders (idempotent)
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    for (const item of items) {
      const slot = rows.slotAt(item.index);
      if (slot.kind === "placeholder") {
        rows.materialize(slot.chunkIdx);
      }
    }
  }, [items, rows]);

  // Ordinal anchoring (spec amendment 3): row-count corrections above the
  // viewport shift content, so track the topmost visible ordinal and
  // re-scroll to its corrected row index whenever accounting changes.
  const anchorRef = useRef<number | undefined>(undefined);
  const versionRef = useRef(rows.version);
  useEffect(() => {
    if (rows.version !== versionRef.current) {
      versionRef.current = rows.version;
      if (anchorRef.current !== undefined) {
        virtualizer.scrollToIndex(rows.rowIndexForOrdinal(anchorRef.current), {
          align: "start",
        });
      }
    }
  });
  useEffect(() => {
    const first = items.find((item) => rows.slotAt(item.index).kind === "row");
    if (first !== undefined) {
      const slot = rows.slotAt(first.index);
      if (slot.kind === "row") {
        anchorRef.current = slot.row.ordinal;
      }
    }
  }, [items, rows]);

  const eventCallbacks = useMemo(
    () => ({
      getCollapsed: (nodeId: string) => rows.isCollapsed(nodeId),
      onCollapse: (nodeId: string, collapsed: boolean) => {
        collapseEvent(kTranscriptCollapseScope, nodeId, collapsed);
      },
    }),
    [rows, collapseEvent]
  );

  const jumpToOrdinal = useCallback(
    (ordinal: number) => {
      anchorRef.current = ordinal;
      virtualizer.scrollToIndex(rows.rowIndexForOrdinal(ordinal), {
        align: "start",
      });
    },
    [virtualizer, rows]
  );

  // Swimlane selection: scroll the body to the selected span's begin
  // ordinal (the body always renders the full raw tree — see docstring).
  const spanBeginByid = useMemo(
    () =>
      new Map(
        chunked.skeleton.spans.map((span) => [span.id, span.begin] as const)
      ),
    [chunked]
  );
  const handleRowSelect = useCallback(
    (key: string | null) => {
      setSelectedRow(key);
      if (key === null) return;
      const span = getSelectedSpans(timelineState.rows, key)[0];
      const begin = span !== undefined ? spanBeginByid.get(span.id) : undefined;
      if (begin !== undefined) jumpToOrdinal(begin);
    },
    [timelineState.rows, spanBeginByid, jumpToOrdinal]
  );
  const swimlaneNavigation = useMemo(
    () => ({
      selected: timelineState.selected,
      select: handleRowSelect,
      clearSelection: () => setSelectedRow(null),
    }),
    [timelineState.selected, handleRowSelect]
  );

  const swimlaneHeader = useMemo(
    () => ({
      rootLabel: timelineData.root.name,
      minimap: {
        root: timelineData.root,
        selection: minimapSelection,
        mapping: rootTimeMapping,
      },
      timelineConfig,
    }),
    [timelineData.root, minimapSelection, rootTimeMapping, timelineConfig]
  );

  // Outline navigation: node ids are synthetic uuids; map to ordinals.
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(
    null
  );
  const navigateToOutlineEvent = useCallback(
    (eventId: string) => {
      const ordinal = synth.ordinals.get(eventId);
      if (ordinal !== undefined) jumpToOrdinal(ordinal);
    },
    [synth, jumpToOrdinal]
  );
  const [outlineScrollEl, setOutlineScrollEl] = useState<HTMLDivElement | null>(
    null
  );

  return (
    <div data-testid={`${id}-chunked`}>
      {hasTimeline && (
        <div className={styles.swimlanes} style={{ top: offsetTop ?? 0 }}>
          <TimelineSwimLanes
            layouts={timelineLayouts}
            timeline={swimlaneNavigation}
            header={swimlaneHeader}
            defaultCollapsed={swimlanesDefaultCollapsed}
            regionCounts={regionCounts}
            highlightedKeys={highlightedKeys}
          />
        </div>
      )}
      <div className={styles.layout}>
        <div
          ref={setOutlineScrollEl}
          className={styles.outline}
          style={{ top: offsetTop ?? 0, maxHeight: "80vh" }}
        >
          <TranscriptOutline
            eventNodes={outlineTree.eventNodes}
            defaultCollapsedIds={outlineTree.defaultCollapsedIds}
            scrollRef={scrollRef}
            outlineScrollEl={outlineScrollEl}
            agentName={selectedRowName}
            onNavigateToEvent={navigateToOutlineEvent}
            getCollapsed={getOutlineCollapsed}
            setCollapsed={setOutlineCollapsed}
            collapsedEvents={outlineCollapsed}
            setCollapsedEvents={setOutlineCollapsedEvents}
            selectedOutlineId={selectedOutlineId}
            setSelectedOutlineId={setSelectedOutlineId}
          />
        </div>
        <div
          className={styles.list}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((item) => {
            const slot = rows.slotAt(item.index);
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={styles.row}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {slot.kind === "row" ? (
                  <div
                    style={{
                      paddingLeft: `${
                        slot.row.depth <= 1
                          ? slot.row.depth * 0.7
                          : (0.7 + slot.row.depth - 1) * 1
                      }em`,
                    }}
                  >
                    <ChunkedRowView
                      row={slot.row}
                      eventCallbacks={eventCallbacks}
                    />
                  </div>
                ) : (
                  <div className={styles.placeholder} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

