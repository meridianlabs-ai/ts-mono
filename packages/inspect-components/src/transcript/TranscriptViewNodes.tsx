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
import {
  kScrollTrackTolerancePx,
  useListKeyboardNavigation,
  useProperty,
  useScrollTrack,
} from "@tsmono/react/hooks";
import type { VirtualListHandle } from "@tsmono/react/virtual";

import { modelEventTabNames } from "./ModelEventView";
import { TranscriptVirtualList } from "./TranscriptVirtualList";
import { findCollapsedAncestors, flatTree } from "./transform/flatten";
import { pairToolApprovals } from "./transform/toolApprovals";
import { TurnHeader } from "./TurnHeader";
import {
  computeTranscriptTurns,
  computeTurnAnchorIds,
  kTranscriptScrollPaddingStart,
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
  /** The headroom-suppression hook (`onHeadroomResetAnchor`), called before
   *  this list's own programmatic scrolls (j/k, turn nav, outline/search) so
   *  the swimlane headroom doesn't flicker open/closed mid-scroll. `true`
   *  engages the debounced lock. */
  onProgrammaticScroll?: (debounce?: boolean) => void;
  /** `h` — select the previous agent lane (driven by the parent's swimlane
   *  selection so the lane highlight + scoping update too). */
  onPrevAgent?: () => void;
  /** `l` — select the next agent lane. */
  onNextAgent?: () => void;
  /** Called when an explicit turn navigation lands (j/k, chevrons, editable
   *  number) so the app can reflect the turn in the URL (`?event=`, replace) —
   *  like an outline click. NOT called on passive scroll. */
  onNavigatedToEvent?: (eventId: string) => void;
  /** Disable turn/agent keyboard nav while find-in-page owns the keyboard. */
  keyboardNavDisabled?: boolean;
}

export interface TranscriptViewNodesHandle {
  /** Scroll to an event by its ID. Expands collapsed ancestors first if needed. */
  scrollToEvent: (eventId: string) => void;
  /** Read-only accessor for the current flattened nodes (post-collapse filter). */
  getFlattenedNodes: () => EventNode[];
  /** Read-only accessor for the virtual list's currently-rendered visible range. */
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
    onProgrammaticScroll,
    onPrevAgent,
    onNextAgent,
    onNavigatedToEvent,
    keyboardNavDisabled,
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

  // The one scroll primitive: scroll a flattened-list row to the top. VirtualList's
  // scrollPaddingStart lands it just below the sticky chrome (and survives the
  // virtualizer's reconcile). Used for deep-link/outline/sidebar jumps,
  // search/timeline clicks (via scrollToEvent), and j/k turn nav.
  const scrollRowToTop = useCallback(
    (index: number) => {
      onProgrammaticScroll?.(true);
      listHandle.current?.scrollToIndex({
        index,
        align: "start",
        behavior: "auto",
      });
    },
    [onProgrammaticScroll]
  );

  const scrollToEvent = useCallback(
    (eventId: string) => {
      const tryScroll = (idx: number) => {
        if (listHandle.current) {
          scrollRowToTop(idx);
        } else {
          onProgrammaticScroll?.(true);
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
      onProgrammaticScroll?.(true);
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
      onProgrammaticScroll,
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
  // tracked by useScrollTrack below.
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const currentTurnIndexRef = useRef(0);
  useEffect(() => {
    currentTurnIndexRef.current = currentTurnIndex;
  }, [currentTurnIndex]);

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
    lastScrolledKeyRef.current = targetKey;
    scrollRowToTop(idx);
    // `?message=` deep link: scrolling the event row to the top isn't enough
    // when the cited message sits far down the event - settle the
    // [data-message-id] element below the chrome, retrying a few frames as late
    // layout (markdown/code/images) reflows.
    if (!initialMessageId) return;
    const container = scrollRef?.current;
    if (!container) return;
    const selector = `[data-message-id="${escapeAttr(initialMessageId)}"]`;
    let raf = 0;
    let frame = 0;
    const settle = () => {
      const el = container.querySelector<HTMLElement>(selector);
      if (el) {
        const delta =
          el.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          offsetTop;
        if (Math.abs(delta) > 2) container.scrollTop += delta;
      }
      if (frame++ < 8) raf = requestAnimationFrame(settle);
    };
    raf = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(raf);
  }, [
    scrollEventId,
    initialMessageId,
    flattenedNodes,
    scrollRowToTop,
    scrollRef,
    offsetTop,
  ]);

  // ---------------------------------------------------------------------------
  // Turn navigation (j/k + header chevrons)
  // ---------------------------------------------------------------------------

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
      const anchorId = turnAnchorIds[clamped];
      if (anchorId && onNavigatedToEvent) {
        // Reflect the landed turn in the URL (?event=) like an outline click.
        // Prime the deep-link dedup so the resulting ?event= change doesn't
        // re-scroll (we've already scrolled). Message is cleared by the app, so
        // the key has an empty message segment.
        lastScrolledKeyRef.current = `${anchorId}:`;
        onNavigatedToEvent(anchorId);
      }
    },
    [turnAnchorIds, scrollRowToTop, onNavigatedToEvent]
  );

  const onNext = useCallback(
    () => goToTurn(currentTurnIndexRef.current + 1),
    [goToTurn]
  );
  // Smart "previous": if we've scrolled deep into a long current turn, k first
  // returns to the top of that turn; only when we're already at/near its top
  // does it step to the previous turn. The anchor lands at
  // kTranscriptScrollPaddingStart (px from the scroller top); only once it sits
  // more than kScrollTrackTolerancePx above that - or has scrolled out of the
  // DOM above - are we mid-turn (return to top), else step back. Same tolerance
  // the scroll tracker uses, so "at the top" means one thing everywhere.
  const onPrev = useCallback(() => {
    const idx = currentTurnIndexRef.current;
    const container = scrollRef?.current;
    const anchorId = turnAnchorIds[idx];
    if (container && anchorId) {
      const el = container.querySelector(`[id="${escapeAttr(anchorId)}"]`);
      if (!el) {
        goToTurn(idx);
        return;
      }
      const anchorTop =
        el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      if (anchorTop < kTranscriptScrollPaddingStart - kScrollTrackTolerancePx) {
        goToTurn(idx);
        return;
      }
    }
    goToTurn(idx - 1);
  }, [goToTurn, turnAnchorIds, scrollRef]);

  const eventCallbacks = useMemo<EventPanelCallbacks>(
    () => ({
      onCollapse: onCollapseTranscript,
      getCollapsed,
      getEventUrl,
      linkingEnabled,
    }),
    [onCollapseTranscript, getCollapsed, getEventUrl, linkingEnabled]
  );

  const onFirst = useCallback(() => goToTurn(0), [goToTurn]);
  const onLast = useCallback(
    () => goToTurn(turnAnchorIds.length - 1),
    [goToTurn, turnAnchorIds.length]
  );

  useListKeyboardNavigation({
    listHandle,
    scrollRef,
    itemCount: flattenedNodes.length,
    onNext,
    onPrev,
    onPrevAgent,
    onNextAgent,
    onFirst: turnAnchorIds.length > 0 ? onFirst : undefined,
    onLast: turnAnchorIds.length > 0 ? onLast : undefined,
    disabled: keyboardNavDisabled,
  });

  // The sticky strip reflects the turn at the top of the viewport, tracked off
  // the topmost visible row via the same useScrollTrack the outline uses (works
  // for virtual and non-virtual, and near the bottom it falls back to the last
  // visible row so the final turns can still become current). Track *every* row,
  // not just turn anchors: computedTurnMap maps tool/content rows to their
  // model's turn, so a long turn whose anchor has scrolled out of the DOM still
  // reads correctly. Rows above the first turn default to turn 1.
  const trackedEventIds = useMemo(
    () => flattenedNodes.map((n) => n.id),
    [flattenedNodes]
  );
  const onTopEvent = useCallback(
    (eventId: string) => {
      const idx = (computedTurnMap.get(eventId)?.turnNumber ?? 1) - 1;
      setCurrentTurnIndex((prev) => (prev === idx ? prev : idx));
    },
    [computedTurnMap]
  );
  useScrollTrack(trackedEventIds, onTopEvent, scrollRef, {
    topOffset: offsetTop,
  });

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
            onGoToTurn={(n) => goToTurn(n - 1)}
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
          className={clsx(className)}
          initialEventId={scrollEventId}
          renderAgentCard={renderAgentCard}
          turnMap={computedTurnMap}
          eventCallbacks={eventCallbacks}
          eventNodeContext={mergedEventNodeContext}
          visibleRangeRef={visibleRangeRef}
        />
      </div>
    </StickyScrollProvider>
  );
});
