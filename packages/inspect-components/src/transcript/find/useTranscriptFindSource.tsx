import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type { Event } from "@tsmono/inspect-common/types";
import {
  useFindCorpus,
  useOptionalFindSnapshot,
  useRegisterFindSource,
  type FindSegment,
  type FindSource,
} from "@tsmono/react/find";

import { EventLabelContext } from "../EventLabelContext";
import { computeHasToolEventsAtDepth } from "../hasToolEventsAtDepth";
import { buildEventNodes } from "../hooks/useEventNodes";
import type { TimelineSpan } from "../timeline/core";
import type { SwimlaneRow } from "../timeline/swimlaneRows";
import {
  collectPathWithNavigators,
  collectRawEvents,
  getBranchPrefix,
  getSelectedSpans,
  parseSelection,
} from "../timeline/timelineEventNodes";
import type { TranscriptViewNodesHandle } from "../TranscriptViewNodes";
import { RenderedEventNode } from "../TranscriptVirtualList";
import { computeVisualActionContext } from "../transcriptVisualActions";
import { findCollapsedAncestors, flatTree } from "../transform/flatten";
import { pairToolApprovals } from "../transform/toolApprovals";
import type {
  EventNode,
  EventNodeContext,
  TranscriptCollapseState,
} from "../types";

export interface UseTranscriptFindSourceOptions {
  /** Full (all-lane) searchable event stream, hidden-type filtered. */
  events: Event[];
  rows: SwimlaneRow[];
  showSwimlanes: boolean;
  includeUtility: boolean;
  showBranches: boolean;
  running: boolean;
  selected: string | null;
  onSelect: (rowKey: string | null) => void;
  viewNodesRef: RefObject<TranscriptViewNodesHandle | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The currently rendered (selected-lane) tree + collapse state, used to
   *  reveal matches hidden in tree-collapsed regions. */
  eventNodes: EventNode[];
  defaultCollapsedIds: Record<string, true>;
  collapseState?: TranscriptCollapseState;
  eventLabels?: Record<string, string>;
}

interface CorpusItem {
  key: string;
  laneKey: string | null;
  node: EventNode;
  next: EventNode | undefined;
  context: EventNodeContext;
  cacheKey: unknown[];
}

interface PendingReveal {
  key: string;
  onSettled: () => void;
  // One-shot latches (mutated in place): each converging action fires at most
  // once per reveal, so a no-op action can't loop (progress accounting, not a
  // retry budget).
  laneSwitched: boolean;
  expanded: boolean;
}

const containsNode = (nodes: EventNode[], id: string): boolean => {
  for (const node of nodes) {
    if (node.id === id) return true;
    if (node.children.length > 0 && containsNode(node.children, id)) {
      return true;
    }
  }
  return false;
};

const escapeAttr = (id: string): string =>
  typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(id)
    : id.replace(/"/g, '\\"');

/** Registers the transcript as a find source.
 *
 *  Corpus, by construction: every lane's rows are rendered through the
 *  SAME pipeline the transcript uses when that lane is selected
 *  (getSelectedSpans → collectRawEvents → buildEventNodes → RenderedEventNode)
 *  into an offscreen probe, and the rendered text is what gets searched.
 *  Document order is lane order, rows flattened fully expanded.
 *
 *  Returns the probe node — the caller must render it inside the transcript
 *  tree so probe rows inherit every provider the live rows see.
 */
export function useTranscriptFindSource(
  options: UseTranscriptFindSourceOptions
): ReactNode {
  const {
    events,
    rows,
    showSwimlanes,
    includeUtility,
    showBranches,
    running,
    selected,
    onSelect,
    viewNodesRef,
    scrollRef,
    eventNodes,
    defaultCollapsedIds,
    collapseState,
    eventLabels,
  } = options;

  const snapshot = useOptionalFindSnapshot();
  const findActive = snapshot.active;

  const lanes = useMemo(() => {
    // Corpus construction is expensive on big logs — never pay for it while
    // the band is closed (streaming appends would rebuild it per event).
    if (!findActive) return null;
    if (!showSwimlanes || rows.length === 0) return null;
    const out: {
      laneKey: string;
      events: Event[];
      sourceSpans: Map<string, TimelineSpan>;
    }[] = [];
    for (const row of rows) {
      const spans = getSelectedSpans(rows, row.key);
      if (spans.length === 0) continue;
      const isBranch =
        spans.length === 1 &&
        (row.branch || (spans[0]?.branches.length ?? 0) > 0);
      const collected = isBranch
        ? collectPathWithNavigators(rows, row.key, events)
        : collectRawEvents(spans, {
            includeUtility,
            regionIndex: null,
            showBranches,
            branchPrefix: getBranchPrefix(rows, row.key),
          });
      out.push({
        laneKey: row.key,
        events: collected.events,
        sourceSpans: collected.sourceSpans,
      });
    }
    return out;
  }, [findActive, showSwimlanes, rows, events, includeUtility, showBranches]);

  const items = useMemo<CorpusItem[]>(() => {
    if (!findActive) return [];
    const out: CorpusItem[] = [];
    const seen = new Set<string>();
    const addLane = (laneKey: string | null, laneNodes: EventNode[]) => {
      const flat = flatTree(laneNodes, null);
      const { toolApprovals, hiddenApprovalIds } = pairToolApprovals(laneNodes);
      const hasToolEvents = computeHasToolEventsAtDepth(flat);
      for (let i = 0; i < flat.length; i++) {
        const node = flat[i]!;
        // Synthetic (uuid-less) node ids differ between tree builds, so those
        // rows can't be addressed reliably — their header text stays
        // unsearchable (matches previous behavior).
        if (!node.event.uuid) continue;
        // Agent-card rows render via the host's renderAgentCard, which the
        // probe can't reproduce — skip rather than count text that differs.
        if (node.sourceSpan !== undefined) continue;
        if (hiddenApprovalIds.has(node.id)) continue;
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        const next = flat[i + 1];
        const { inputScreenshot, selfAnnotation } = computeVisualActionContext(
          flat,
          i
        );
        out.push({
          key: node.id,
          laneKey,
          node,
          next,
          context: {
            hasToolEvents: hasToolEvents[i] ?? false,
            toolApprovals,
            inputScreenshot,
            selfAnnotation,
            eventLabels,
          },
          // Rendered text depends on the event payload, (via tool-call
          // folding etc.) the next row, and — for tool rows — the paired
          // approval that streams in later; lane discriminates builds.
          cacheKey: [
            node.event,
            next?.id ?? "",
            laneKey ?? "",
            (node.event.event === "tool" &&
              toolApprovals.get(node.event.id)?.event) ||
              "",
          ],
        });
      }
    };
    if (lanes === null) {
      addLane(null, eventNodes);
    } else {
      for (const lane of lanes) {
        const built = buildEventNodes(lane.events, running, lane.sourceSpans);
        addLane(lane.laneKey, built.eventNodes);
      }
    }
    return out;
  }, [findActive, lanes, eventNodes, running, eventLabels]);

  const { segments, prefixSegments, probe } = useFindCorpus<CorpusItem>({
    items,
    keyOf,
    cacheKeyOf,
    renderItem,
    active: findActive,
  });

  // ----- source object (stable; live values via refs) ----------------------

  const segmentsRef = useRef<readonly FindSegment[] | null>(null);
  const prefixRef = useRef<readonly FindSegment[]>([]);
  const listenersRef = useRef(new Set<() => void>());
  useEffect(() => {
    segmentsRef.current = segments;
    // Notify per extraction batch too: the controller lands match 1 (and
    // extends steppable range) from the growing prefix while counting.
    prefixRef.current = prefixSegments;
    for (const listener of listenersRef.current) listener();
  }, [segments, prefixSegments]);

  const laneByKey = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const item of items) map.set(item.key, item.laneKey);
    return map;
  }, [items]);

  // The pending reveal lives in a ref (mutated only from the reveal()
  // callback and the effect below); the tick state just re-runs the effect.
  const pendingRef = useRef<PendingReveal | null>(null);
  const [pendingTick, setPendingTick] = useState(0);
  // Tree nodes find expanded (previously collapsed) — reverted on band close.
  const findExpandedIdsRef = useRef(new Set<string>());
  // Revert closure rebound each commit so cleanup() sees fresh collapse state.
  const revertExpansionsRef = useRef<() => void>(() => {});
  useEffect(() => {
    revertExpansionsRef.current = () => {
      const setAll = collapseState?.onSetTranscriptCollapsed;
      const ids = [...findExpandedIdsRef.current];
      findExpandedIdsRef.current.clear();
      if (!setAll || ids.length === 0) return;
      const next = { ...(collapseState?.transcript ?? defaultCollapsedIds) };
      for (const id of ids) next[id] = true;
      setAll(next);
    };
  });
  // Tab switches unmount this source before the band closes — revert here
  // too, or find-caused tree expansions outlive the session.
  useEffect(() => () => revertExpansionsRef.current(), []);

  const source = useMemo<FindSource>(
    () => ({
      getSegments: () => segmentsRef.current,
      getPrefixSegments: () => prefixRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
      reveal: (key, onSettled) => {
        pendingRef.current = {
          key,
          onSettled,
          laneSwitched: false,
          expanded: false,
        };
        setPendingTick((t) => t + 1);
      },
      getContainer: () => scrollRef.current,
      getElement: (key) =>
        scrollRef.current?.querySelector<HTMLElement>(
          `[id="${escapeAttr(key)}"]`
        ) ?? null,
      cleanup: () => {
        revertExpansionsRef.current();
        pendingRef.current = null;
      },
    }),
    [scrollRef]
  );
  useRegisterFindSource(source);

  // ----- reveal convergence -------------------------------------------------
  // Runs after every commit that can change reachability (lane switch, tree
  // expansion, remount); each run performs at most one converging action,
  // latched on the pending record so a no-op action can't loop.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const view = viewNodesRef.current;
    const flattened = view?.getFlattenedNodes() ?? [];
    if (view && flattened.some((n) => n.id === pending.key)) {
      pendingRef.current = null;
      view.scrollToEvent(pending.key, {
        align: "center",
        onDone: pending.onSettled,
      });
      return;
    }
    if (containsNode(eventNodes, pending.key)) {
      const collapsed = collapseState?.transcript ?? defaultCollapsedIds;
      const ancestors = findCollapsedAncestors(
        eventNodes,
        pending.key,
        collapsed
      );
      const setAll = collapseState?.onSetTranscriptCollapsed;
      if (ancestors.length > 0 && setAll && !pending.expanded) {
        pending.expanded = true;
        const next = { ...collapsed };
        for (const id of ancestors) {
          if (collapsed[id]) findExpandedIdsRef.current.add(id);
          next[id] = false;
        }
        setAll(next);
        return;
      }
    } else {
      const laneKey = laneByKey.get(pending.key);
      const currentLaneKey =
        parseSelection(selected)?.rowKey ?? rows[0]?.key ?? null;
      if (
        laneKey !== undefined &&
        laneKey !== null &&
        !pending.laneSwitched &&
        // Also fires when already "on" the lane but region/span-scoped
        // (selected carries :N/@R modifiers) — reselecting the bare row key
        // clears the scoping so the whole lane renders.
        (laneKey !== currentLaneKey ||
          (selected !== null && selected !== laneKey))
      ) {
        pending.laneSwitched = true;
        onSelect(laneKey);
        return;
      }
    }
    // Unreachable (corpus/view drift): stop here — the controller's observer
    // simply never paints, and the next navigation supersedes this reveal.
    pendingRef.current = null;
    pending.onSettled();
  }, [
    pendingTick,
    selected,
    rows,
    laneByKey,
    eventNodes,
    defaultCollapsedIds,
    collapseState,
    onSelect,
    viewNodesRef,
  ]);

  return probe;
}

const keyOf = (item: CorpusItem): string => item.key;
const cacheKeyOf = (item: CorpusItem): unknown[] => item.cacheKey;
const renderItem = (item: CorpusItem): ReactNode => (
  <EventLabelContext.Provider value={item.context.eventLabels?.[item.key]}>
    <RenderedEventNode
      node={item.node}
      next={item.next}
      context={item.context}
    />
  </EventLabelContext.Provider>
);
