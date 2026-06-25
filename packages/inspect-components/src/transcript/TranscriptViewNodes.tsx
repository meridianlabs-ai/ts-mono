/**
 * Shared component that wraps TranscriptVirtualList with tree flattening,
 * collapse state, turn-map computation, keyboard navigation, and imperative
 * scroll-to-event/index. Apps provide collapse state via callback props.
 */

import clsx from "clsx";
import {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { StickyScrollProvider } from "@tsmono/react/components";
import { useListKeyboardNavigation, useProperty } from "@tsmono/react/hooks";
import type { VirtualListHandle } from "@tsmono/react/virtual";

import { modelEventTabNames } from "./ModelEventView";
import { TranscriptVirtualList } from "./TranscriptVirtualList";
import { findCollapsedAncestors, flatTree } from "./transform/flatten";
import { pairToolApprovals } from "./transform/toolApprovals";
import { TurnHeader } from "./TurnHeader";
import {
  computeTranscriptTurns,
  computeTurnAnchorIds,
  pickCurrentAnchorIndex,
} from "./turnNavigation";
import type { EventNode, EventNodeContext, EventPanelCallbacks } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface TranscriptViewNodesProps {
  id: string;
  eventNodes: EventNode[];
  defaultCollapsedIds: Record<string, boolean>;
  /** Whether events are still being streamed (enables auto-follow scroll). */
  running?: boolean;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  initialEventId?: string | null;
  /** Optional message ID — after scrolling to the containing event, also
   *  query the DOM for the message and adjust scroll so the message itself
   *  lands at the top of the visible area. */
  initialMessageId?: string | null;
  offsetTop?: number;
  className?: string;
  renderAgentCard?: (node: EventNode, className?: string) => ReactNode;
  turnMap?: Map<string, { turnNumber: number; totalTurns: number }>;
  getEventUrl?: (eventId: string) => string | undefined;
  linkingEnabled?: boolean;
  /** Builds a single-event standalone-page URL for the header's
   *  open-in-new-tab control. Omit to hide that control. */
  getEventFocusUrl?: (eventId: string) => string | undefined;

  // Collapse state (app provides via its store, already scope-specific)
  collapsedTranscript?: Record<string, boolean>;
  onCollapseTranscript?: (nodeId: string, collapsed: boolean) => void;
  /** Expand several nodes in one state update — used to reveal deep-link
   *  targets hidden inside collapsed regions. */
  onExpandNodes?: (nodeIds: string[]) => void;
  /** Extra context fields merged into every EventNodeContext entry. */
  eventNodeContext?: Partial<EventNodeContext>;
}

export interface TranscriptViewNodesHandle {
  /** Scroll to an event by its ID. Expands collapsed ancestors first if needed. */
  scrollToEvent: (eventId: string) => void;
  /** Read-only accessor for the current flattened nodes (post-collapse filter). */
  getFlattenedNodes: () => EventNode[];
  /** Read-only accessor for Virtuoso's currently-rendered visible range. */
  getVisibleRange: () => { startIndex: number; endIndex: number };
}

// =============================================================================
// Imperative scroll helpers
// =============================================================================

const escapeAttr = (id: string): string =>
  typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(id)
    : id.replace(/"/g, '\\"');

// =============================================================================
// Component
// =============================================================================

export const TranscriptViewNodes = forwardRef<
  TranscriptViewNodesHandle,
  TranscriptViewNodesProps
>(function TranscriptViewNodes(
  {
    id,
    eventNodes,
    defaultCollapsedIds,
    running,
    scrollRef,
    initialEventId,
    initialMessageId,
    offsetTop = 10,
    className,
    renderAgentCard,
    turnMap,
    getEventUrl,
    linkingEnabled,
    getEventFocusUrl,
    collapsedTranscript,
    onCollapseTranscript,
    onExpandNodes,
    eventNodeContext,
  },
  ref
) {
  const listHandle = useRef<VirtualListHandle | null>(null);

  const getCollapsed = useCallback(
    (nodeId: string) => {
      return (collapsedTranscript || defaultCollapsedIds)[nodeId] === true;
    },
    [collapsedTranscript, defaultCollapsedIds]
  );

  // Pair each ApprovalEvent to its ToolEvent by call.id, so ToolEventView
  // can render the approval inline without nesting it in the tree (which
  // would give the tool panel a bogus expand chevron).
  const { toolApprovals, hiddenApprovalIds, approvalScrollRedirects } = useMemo(
    () => pairToolApprovals(eventNodes),
    [eventNodes]
  );

  // Hidden approvals have no row of their own — retarget deep links at the
  // tool row that renders them inline.
  const scrollEventId = initialEventId
    ? (approvalScrollRedirects.get(initialEventId) ?? initialEventId)
    : initialEventId;

  const flattenedNodes = useMemo(() => {
    const all = flatTree(
      eventNodes,
      collapsedTranscript || defaultCollapsedIds
    );
    return hiddenApprovalIds.size === 0
      ? all
      : all.filter((n) => !hiddenApprovalIds.has(n.id));
  }, [eventNodes, collapsedTranscript, defaultCollapsedIds, hiddenApprovalIds]);

  const mergedEventNodeContext = useMemo<Partial<EventNodeContext>>(
    () => ({ ...eventNodeContext, toolApprovals }),
    [eventNodeContext, toolApprovals]
  );

  // Turn map + anchors. Use the parent-provided map when given, else compute
  // both from the shared helper (collapse-independent numbering; same
  // event-type filtering as the sidebar).
  const { computedTurnMap, turnAnchorIds } = useMemo(() => {
    if (turnMap) {
      return {
        computedTurnMap: turnMap,
        turnAnchorIds: computeTurnAnchorIds(flattenedNodes, turnMap),
      };
    }
    const { turnMap: computed, anchorIds } = computeTranscriptTurns(
      eventNodes,
      flattenedNodes,
      defaultCollapsedIds
    );
    return { computedTurnMap: computed, turnAnchorIds: anchorIds };
  }, [turnMap, eventNodes, flattenedNodes, defaultCollapsedIds]);

  // The one scroll primitive: put a flattened-list row's event panel top at the
  // sticky line (just under the `offsetTop` chrome). Used for deep-link/outline/
  // sidebar jumps, search/timeline clicks (via scrollToEvent), and j/k turn nav.
  //
  // scrollToIndex gets the row into view (and mounts it — the target may not be
  // in the DOM yet, so a plain `#id` scroll can't work) but does NOT land it
  // precisely: it positions by the virtualizer's *estimated* row heights and
  // keeps re-adjusting over the next frames as the now-mounted rows measure their
  // real height, so a one-shot scroll settles at an estimate-/history-dependent
  // spot (jumping to a turn from far vs from nearby lands it differently — the
  // re-navigation drift). Re-assert the exact line from the panel's real DOM rect
  // each frame until stable, capped so a row that physically can't reach the line
  // (e.g. the last row, near the end of the list) stops.
  //
  // We measure the event panel by its `[id]` — the same element currentTurnFrom-
  // Viewport uses to decide the current turn — so the landing and the "turn N/M"
  // label agree (the row wrapper's top sits a few px above the panel, which would
  // otherwise leave the target one turn off).
  const scrollRowToTop = useCallback(
    (index: number) => {
      const container = scrollRef?.current;
      listHandle.current?.scrollToIndex({
        index,
        align: "start",
        behavior: "auto",
        offset: offsetTop ? -offsetTop : undefined,
      });
      const id = flattenedNodesLatest.current[index]?.id;
      if (!container || !id) return;
      // Keep re-asserting across the whole window rather than bailing at the
      // first aligned frame: the row mounts a frame or two in, and a competing
      // mount-time scroll (the VirtualList's own initialIndex deep-link) can fire
      // *after* we've aligned and knock the row off the line — re-correcting each
      // frame catches that. The window is short enough not to fight a real user
      // scroll (j/k/deep-link is itself a scroll command, not hand-scrolling).
      let frames = 0;
      const settle = () => {
        const panel = container.querySelector<HTMLElement>(
          `[id="${escapeAttr(id)}"]`
        );
        if (panel) {
          const delta =
            panel.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            (offsetTop ?? 0);
          if (Math.abs(delta) > 1) container.scrollBy({ top: delta });
        }
        if (++frames < 12) requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
    },
    [offsetTop, scrollRef]
  );

  const scrollToEvent = useCallback(
    (eventId: string) => {
      const tryScroll = (idx: number) => {
        if (listHandle.current) {
          scrollRowToTop(idx);
        } else {
          const el = scrollRef?.current?.querySelector(
            `[id="${escapeAttr(eventId)}"]`
          );
          el?.scrollIntoView({ block: "start", behavior: "auto" });
        }
      };

      const idx = flattenedNodes.findIndex((e) => e.id === eventId);
      if (idx !== -1) {
        tryScroll(idx);
        return;
      }

      // Event is not in the flat list — collapsed ancestors hide it. Expand them
      // in one batched update (sequential single-node toggles each re-seed the
      // collapse defaults and clobber the prior expansion while the store is
      // unseeded — that's why onExpandNodes exists), then retry once the
      // flattened list updates.
      const collapsedAncestors = findCollapsedAncestors(
        eventNodes,
        eventId,
        collapsedTranscript ?? defaultCollapsedIds
      );
      if (collapsedAncestors.length > 0 && onExpandNodes) {
        onExpandNodes(collapsedAncestors);
        // After the next render, the flat list will include the event.
        // Retry up to 3 frames in case React batching pushes the commit later.
        const retryScroll = (attemptsLeft: number) => {
          const newIdx = flattenedNodesLatest.current.findIndex(
            (e) => e.id === eventId
          );
          if (newIdx !== -1) {
            tryScroll(newIdx);
            return;
          }
          if (attemptsLeft > 0) {
            requestAnimationFrame(() => retryScroll(attemptsLeft - 1));
          }
        };
        requestAnimationFrame(() => retryScroll(3));
        return;
      }

      // Fall back to direct DOM scroll.
      const el = scrollRef?.current?.querySelector(
        `[id="${escapeAttr(eventId)}"]`
      );
      el?.scrollIntoView({ block: "start", behavior: "auto" });
    },
    [
      flattenedNodes,
      eventNodes,
      collapsedTranscript,
      defaultCollapsedIds,
      onExpandNodes,
      scrollRowToTop,
      scrollRef,
    ]
  );

  const flattenedNodesLatest = useRef<EventNode[]>(flattenedNodes);
  useEffect(() => {
    flattenedNodesLatest.current = flattenedNodes;
  }, [flattenedNodes]);

  const visibleRangeRef = useRef<{ startIndex: number; endIndex: number }>({
    startIndex: 0,
    endIndex: 0,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToEvent,
      getFlattenedNodes: () => flattenedNodesLatest.current,
      getVisibleRange: () => visibleRangeRef.current,
    }),
    [scrollToEvent]
  );

  // Runtime URL→event navigation. The mount-time anchor lives in
  // TranscriptVirtualListComponent (frozen at first render); after mount,
  // any change to `initialEventId` / `initialMessageId` (e.g. user clicks
  // an outline link or scan-citation link) flows through here and scrolls
  // imperatively. The combined key dedups so re-renders driven by
  // `flattenedNodes` changes (filter/collapse) don't re-fire a scroll for
  // an already-handled target — but two messages that resolve to the same
  // event panel still re-fire when `initialMessageId` differs.
  // Deep links into collapsed regions: the target has no row until its
  // collapsed ancestors are expanded. Expand them once per target — the
  // scroll effect below re-fires when the flattened list updates. Guarded
  // per target so a stale URL param doesn't fight the user re-collapsing.
  const expandedForTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollEventId || !onExpandNodes) return;
    if (expandedForTargetRef.current === scrollEventId) return;
    if (flattenedNodes.some((n) => n.id === scrollEventId)) return;
    const collapsedAncestors = findCollapsedAncestors(
      eventNodes,
      scrollEventId,
      collapsedTranscript ?? defaultCollapsedIds
    );
    if (collapsedAncestors.length === 0) return;
    expandedForTargetRef.current = scrollEventId;
    onExpandNodes(collapsedAncestors);
  }, [
    scrollEventId,
    onExpandNodes,
    flattenedNodes,
    eventNodes,
    collapsedTranscript,
    defaultCollapsedIds,
  ]);

  // Turn shown in the sticky header — the turn at the top of the viewport,
  // tracked from DOM positions on every scroll (handleVisibleRange below).
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const currentTurnIndexRef = useRef(0);
  useEffect(() => {
    currentTurnIndexRef.current = currentTurnIndex;
  }, [currentTurnIndex]);

  const offsetTopRef = useRef(offsetTop);
  useEffect(() => {
    offsetTopRef.current = offsetTop;
  }, [offsetTop]);

  // Runtime URL→event scroll (deep link / outline / sidebar turn link). Dedup by
  // target so re-renders from filter/collapse don't re-fire an already-handled
  // jump.
  const lastScrolledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollEventId) {
      lastScrolledKeyRef.current = null;
      return;
    }
    const targetKey = `${scrollEventId}:${initialMessageId ?? ""}`;
    if (lastScrolledKeyRef.current === targetKey) return;
    const idx = flattenedNodes.findIndex((n) => n.id === scrollEventId);
    if (idx === -1) return;
    const container = scrollRef?.current;
    lastScrolledKeyRef.current = targetKey;
    scrollRowToTop(idx);
    // Message-level deep link (scan citation): once the row mounts, bring the
    // specific message to the sticky line. scrollIntoView lands it at the
    // container top (0); nudge down by offsetTop so it clears the sticky chrome.
    if (initialMessageId && container) {
      requestAnimationFrame(() => {
        const el = container.querySelector<HTMLElement>(
          `[data-message-id="${escapeAttr(initialMessageId)}"]`
        );
        if (!el) return;
        el.scrollIntoView({ block: "start", behavior: "auto" });
        if (offsetTopRef.current) {
          container.scrollBy({ top: -offsetTopRef.current, behavior: "auto" });
        }
      });
    }
  }, [scrollEventId, initialMessageId, flattenedNodes, scrollRef, scrollRowToTop]);

  // ---------------------------------------------------------------------------
  // Turn navigation (j/k + header chevrons)
  // ---------------------------------------------------------------------------

  const anchorIndexById = useMemo(() => {
    const m = new Map<string, number>();
    turnAnchorIds.forEach((id, i) => m.set(id, i));
    return m;
  }, [turnAnchorIds]);

  // The turn at the top of the viewport, from the on-screen turn-anchor rows' DOM
  // positions. The activation `line` uses the same `offsetTop` that scrollRowToTop
  // scrolls to, so the current turn matches where a jump lands.
  const currentTurnFromViewport = useCallback((): number => {
    const container = scrollRef?.current;
    if (!container) return -1;
    const line =
      container.getBoundingClientRect().top + (offsetTopRef.current ?? 0);
    const anchors: { index: number; top: number }[] = [];
    for (const el of container.querySelectorAll<HTMLElement>("[id]")) {
      const ai = anchorIndexById.get(el.id);
      if (ai !== undefined) {
        anchors.push({ index: ai, top: el.getBoundingClientRect().top });
      }
    }
    return pickCurrentAnchorIndex(anchors, line);
  }, [anchorIndexById, scrollRef]);

  const goToTurn = useCallback(
    (index: number) => {
      if (turnAnchorIds.length === 0) return;
      const clamped = Math.max(0, Math.min(turnAnchorIds.length - 1, index));
      const flatIdx = flattenedNodesLatest.current.findIndex(
        (n) => n.id === turnAnchorIds[clamped]
      );
      if (flatIdx === -1) return;
      scrollRowToTop(flatIdx);
      setCurrentTurnIndex(clamped);
    },
    [turnAnchorIds, scrollRowToTop]
  );

  // Step from the *tracked* current turn, not a fresh viewport read. handle-
  // VisibleRange keeps currentTurnIndex in sync with the viewport as you scroll
  // (incl. free scroll), settling on the stable turn; a synchronous read here can
  // instead catch a transient value while a prior jump's scroll is still settling
  // (which made j/k step the wrong way / stall when turns are short and dense).
  const stepTurn = useCallback(
    (delta: 1 | -1) => {
      goToTurn(currentTurnIndexRef.current + delta);
    },
    [goToTurn]
  );

  const onNext = useCallback(() => stepTurn(1), [stepTurn]);
  const onPrev = useCallback(() => stepTurn(-1), [stepTurn]);

  const eventCallbacks = useMemo<EventPanelCallbacks>(
    () => ({
      onCollapse: onCollapseTranscript,
      getCollapsed,
      getEventUrl,
      linkingEnabled,
    }),
    [onCollapseTranscript, getCollapsed, getEventUrl, linkingEnabled]
  );

  useListKeyboardNavigation({
    listHandle,
    scrollRef,
    itemCount: flattenedNodes.length,
    onNext,
    onPrev,
  });

  // The sticky strip reflects the turn topping the viewport — recomputed on
  // every visible-range change (which fires while scrolling).
  const handleVisibleRange = useCallback(() => {
    const idx = currentTurnFromViewport();
    if (idx !== -1) setCurrentTurnIndex((prev) => (prev === idx ? prev : idx));
  }, [currentTurnFromViewport]);

  const showTurnHeader = turnAnchorIds.length > 0;
  const turnIndex = Math.min(currentTurnIndex, turnAnchorIds.length - 1);
  const turnAnchorId = turnAnchorIds[turnIndex];
  const turnInfo = turnAnchorId ? computedTurnMap.get(turnAnchorId) : undefined;

  // Carry the current turn model's selected tab into the open-in-new-tab link,
  // so the focus page opens on the same tab (it's a new browser tab, so the
  // selection can't be shared in memory — it travels in the URL).
  const currentAnchorNode = useMemo(
    () => flattenedNodes.find((n) => n.id === turnAnchorId),
    [flattenedNodes, turnAnchorId]
  );
  const anchorTabNames =
    currentAnchorNode?.event.event === "model"
      ? modelEventTabNames(currentAnchorNode.event)
      : undefined;
  const [anchorSelectedNav] = useProperty(turnAnchorId ?? "", "selectedNav", {
    defaultValue: turnAnchorId ? `${turnAnchorId}-nav-pill-0` : "",
  });
  const anchorTab =
    anchorTabNames?.[
      Number(anchorSelectedNav.slice(anchorSelectedNav.lastIndexOf("-") + 1)) ||
        0
    ];
  const focusBaseUrl = turnAnchorId
    ? getEventFocusUrl?.(turnAnchorId)
    : undefined;
  const focusUrl =
    focusBaseUrl && anchorTab
      ? `${focusBaseUrl}&tab=${encodeURIComponent(anchorTab)}`
      : focusBaseUrl;

  // Provide the sticky offset to the event-panel sticky headers without
  // threading offsetTop through every event-view layer. Memoized so it doesn't
  // churn consumers each render.
  const stickyScroll = useMemo(() => ({ stickyTop: offsetTop }), [offsetTop]);

  return (
    <StickyScrollProvider value={stickyScroll}>
      <div>
        {showTurnHeader && (
          <TurnHeader
            turnNumber={turnInfo?.turnNumber ?? turnIndex + 1}
            totalTurns={turnInfo?.totalTurns ?? turnAnchorIds.length}
            onPrev={onPrev}
            onNext={onNext}
            hasPrev={turnIndex > 0}
            hasNext={turnIndex < turnAnchorIds.length - 1}
            focusUrl={focusUrl}
            offsetTop={offsetTop}
          />
        )}
        <TranscriptVirtualList
          id={id}
          listHandle={listHandle}
          eventNodes={flattenedNodes}
          scrollRef={scrollRef}
          running={running}
          offsetTop={offsetTop}
          className={clsx(className)}
          initialEventId={scrollEventId}
          renderAgentCard={renderAgentCard}
          turnMap={computedTurnMap}
          eventCallbacks={eventCallbacks}
          eventNodeContext={mergedEventNodeContext}
          visibleRangeRef={visibleRangeRef}
          onVisibleRangeChange={handleVisibleRange}
        />
      </div>
    </StickyScrollProvider>
  );
});
