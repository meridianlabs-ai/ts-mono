/**
 * Shared component that wraps TranscriptVirtualList with tree flattening,
 * collapse state, turn-map computation, keyboard navigation, and imperative
 * scroll-to-event/index. Apps provide collapse state via callback props.
 */

import clsx from "clsx";
import {
  CSSProperties,
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { VirtuosoHandle } from "react-virtuoso";

import type { ApprovalEvent } from "@tsmono/inspect-common/types";
import { StickyScrollProvider } from "@tsmono/react/components";
import { useListKeyboardNavigation } from "@tsmono/react/hooks";

import {
  computeTurnMap,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
} from "./outline/tree-visitors";
import { TranscriptVirtualList } from "./TranscriptVirtualList";
import { kSandboxSignalName } from "./transform/fixups";
import { flatTree } from "./transform/flatten";
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

  // Collapse state (app provides via its store, already scope-specific)
  collapsedTranscript?: Record<string, boolean>;
  /** Outline collapse state, used only for turn-map computation. */
  collapsedOutline?: Record<string, boolean>;
  onCollapseTranscript?: (nodeId: string, collapsed: boolean) => void;
  /** Extra context fields merged into every EventNodeContext entry. */
  eventNodeContext?: Partial<EventNodeContext>;
}

export interface TranscriptViewNodesHandle {
  /** Scroll to an event by its ID. */
  scrollToEvent: (eventId: string) => void;
  /** Scroll to a flattened-list index. */
  scrollToIndex: (index: number) => void;
}

// =============================================================================
// Imperative scroll helpers
// =============================================================================

/** Pixels of breathing room below the sticky bar where the target lands. */
const kPaddingBelowSticky = 20;

/** Settle iteration budget — caps how long we keep adjusting scroll while
 *  Virtuoso re-measures items after a mount. ~1.5s at 60fps. */
const kSettleAttemptLimit = 90;

/** Frames the computed scroll target must hold steady before we stop. */
const kSettleStableFrames = 8;

/** Sticky-bar candidates must span at least this fraction of the container's
 *  width — filters out the (also-sticky) outline / right-pane side panels. */
const kStickyMinWidthRatio = 0.4;

const escapeAttr = (id: string): string =>
  typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(id)
    : id.replace(/"/g, '\\"');

/** Worst-case bottom edge of the top-pinned sticky bar (relative to the
 *  scroll container's top), based on each sticky element's CSS `top` +
 *  measured height. Independent of current scroll state, so iterative
 *  re-scrolling won't oscillate as sticky pins toggle on/off. */
function measureStickyBottom(container: HTMLElement, fallback: number): number {
  const containerRect = container.getBoundingClientRect();
  const minWidth = containerRect.width * kStickyMinWidthRatio;
  let bottom = fallback;
  for (const el of container.querySelectorAll<HTMLElement>("*")) {
    const style = getComputedStyle(el);
    if (style.position !== "sticky") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < minWidth || rect.height === 0) continue;
    const stuckBottom = (parseFloat(style.top) || 0) + rect.height;
    if (stuckBottom > bottom) bottom = stuckBottom;
  }
  return bottom;
}

interface ScrollToEventTargetOptions {
  listHandle: VirtuosoHandle | null;
  index: number;
  container: HTMLElement;
  /** CSS selector for the DOM element that should land at the top — either
   *  the message wrapper (when a message ID is set) or the event panel. */
  targetSelector: string;
  /** Returns the current static top-offset (tab bar etc.). Read each tick
   *  so the swimlane height is picked up after it activates. */
  getStickyOffset: () => number;
  paddingBelowSticky: number;
}

/**
 * Scrolls the given Virtuoso list so the element matching `targetSelector`
 * lands `paddingBelowSticky` below the (worst-case) top sticky bar.
 *
 * Stage 1: two-pass `scrollToIndex` via rAF so the target's row mounts and
 * the sticky swimlane activates with the row clearing it.
 * Stage 2: re-scroll the container based on the target element's actual
 * DOM position, retrying for several frames while Virtuoso re-measures
 * items (markdown / code-block layout shifts the target around).
 *
 * Returns a cleanup that cancels any in-flight rAF.
 */
function scrollToEventTarget({
  listHandle,
  index,
  container,
  targetSelector,
  getStickyOffset,
  paddingBelowSticky,
}: ScrollToEventTargetOptions): () => void {
  const scrollListToIndex = () => {
    const offset = getStickyOffset();
    listHandle?.scrollToIndex({
      index,
      align: "start",
      behavior: "auto",
      offset: offset ? -offset : undefined,
    });
  };

  let lastTarget: number | null = null;
  let stableFrames = 0;
  let attempt = 0;
  const settle = () => {
    attempt++;
    const el = container.querySelector<HTMLElement>(targetSelector);
    if (el) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const stickyBottom = measureStickyBottom(container, getStickyOffset());
      const target =
        container.scrollTop +
        (elRect.top - containerRect.top) -
        (stickyBottom + paddingBelowSticky);
      if (target !== lastTarget) {
        lastTarget = target;
        stableFrames = 0;
        container.scrollTo({ top: target, behavior: "auto" });
      } else {
        stableFrames++;
      }
    }
    if (stableFrames < kSettleStableFrames && attempt < kSettleAttemptLimit) {
      frame = requestAnimationFrame(settle);
    } else {
      frame = null;
    }
  };

  let frame: number | null = requestAnimationFrame(() => {
    scrollListToIndex();
    frame = requestAnimationFrame(() => {
      scrollListToIndex();
      frame = requestAnimationFrame(settle);
    });
  });
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
  };
}

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
    collapsedTranscript,
    collapsedOutline,
    onCollapseTranscript,
    eventNodeContext,
  },
  ref
) {
  const listHandle = useRef<VirtuosoHandle | null>(null);

  const getCollapsed = useCallback(
    (nodeId: string) => {
      return (collapsedTranscript || defaultCollapsedIds)[nodeId] === true;
    },
    [collapsedTranscript, defaultCollapsedIds]
  );

  const eventCallbacks = useMemo<EventPanelCallbacks>(
    () => ({
      onCollapse: onCollapseTranscript,
      getCollapsed,
      getEventUrl,
      linkingEnabled,
    }),
    [onCollapseTranscript, getCollapsed, getEventUrl, linkingEnabled]
  );

  // Pair each ApprovalEvent to its ToolEvent by call.id, so ToolEventView
  // can render the approval inline without nesting it in the tree (which
  // would give the tool panel a bogus expand chevron).
  const { toolApprovals, hiddenApprovalIds } = useMemo(() => {
    const toolIds = new Set<string>();
    const walkTools = (nodes: EventNode[]) => {
      for (const n of nodes) {
        if (n.event.event === "tool") toolIds.add(n.event.id);
        if (n.children.length) walkTools(n.children);
      }
    };
    walkTools(eventNodes);

    const approvals = new Map<string, EventNode<ApprovalEvent>>();
    const hidden = new Set<string>();
    const walkApprovals = (nodes: EventNode[]) => {
      for (const n of nodes) {
        if (n.event.event === "approval") {
          // Auto-approved calls add no information — hide them entirely
          // (don't pair, don't surface as flat rows). Non-approve auto
          // decisions (reject/terminate/…) stay visible.
          const isAutoApprove =
            n.event.approver === "auto" && n.event.decision === "approve";
          if (isAutoApprove) {
            hidden.add(n.id);
          } else if (toolIds.has(n.event.call.id)) {
            approvals.set(n.event.call.id, n as EventNode<ApprovalEvent>);
            hidden.add(n.id);
          }
        }
        if (n.children.length) walkApprovals(n.children);
      }
    };
    walkApprovals(eventNodes);

    return { toolApprovals: approvals, hiddenApprovalIds: hidden };
  }, [eventNodes]);

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

  // Auto-compute turnMap when not provided by the parent
  const computedTurnMap = useMemo(() => {
    if (turnMap) return turnMap;
    const outlineFiltered = flatTree(
      eventNodes,
      collapsedOutline || defaultCollapsedIds,
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
    return computeTurnMap(outlineFiltered, flattenedNodes);
  }, [
    turnMap,
    eventNodes,
    collapsedOutline,
    defaultCollapsedIds,
    flattenedNodes,
  ]);

  const scrollToEvent = useCallback(
    (eventId: string) => {
      const idx = flattenedNodes.findIndex((e) => e.id === eventId);
      if (idx !== -1 && listHandle.current) {
        listHandle.current.scrollToIndex({
          index: idx,
          align: "start",
          behavior: "auto",
          offset: offsetTop ? -offsetTop : undefined,
        });
      } else {
        // Non-virtual fallback: find the DOM element and scroll it into view
        const el = scrollRef?.current?.querySelector(
          `[id="${escapeAttr(eventId)}"]`
        );
        el?.scrollIntoView({ block: "start", behavior: "auto" });
      }
    },
    [flattenedNodes, offsetTop, scrollRef]
  );

  const scrollToIndex = useCallback(
    (index: number) => {
      listHandle.current?.scrollToIndex({
        index,
        align: "start",
        behavior: "auto",
        offset: offsetTop ? -offsetTop : undefined,
      });
    },
    [offsetTop]
  );

  useImperativeHandle(ref, () => ({ scrollToEvent, scrollToIndex }), [
    scrollToEvent,
    scrollToIndex,
  ]);

  // Runtime URL→event navigation. The mount-time anchor lives in
  // TranscriptVirtualListComponent (frozen at first render); after mount,
  // any change to `initialEventId` / `initialMessageId` (e.g. user clicks
  // an outline link or scan-citation link) flows through here and scrolls
  // imperatively. The combined key dedups so re-renders driven by
  // `flattenedNodes` changes (filter/collapse) don't re-fire a scroll for
  // an already-handled target — but two messages that resolve to the same
  // event panel still re-fire when `initialMessageId` differs.
  const lastScrolledKeyRef = useRef<string | null>(null);
  const offsetTopRef = useRef(offsetTop);
  useEffect(() => {
    offsetTopRef.current = offsetTop;
  }, [offsetTop]);
  useEffect(() => {
    if (!initialEventId) {
      lastScrolledKeyRef.current = null;
      return;
    }
    const targetKey = `${initialEventId}:${initialMessageId ?? ""}`;
    if (lastScrolledKeyRef.current === targetKey) return;
    const idx = flattenedNodes.findIndex((n) => n.id === initialEventId);
    if (idx === -1) return;
    const container = scrollRef?.current;
    if (!container) return;
    lastScrolledKeyRef.current = targetKey;
    const targetSelector = initialMessageId
      ? `[data-message-id="${escapeAttr(initialMessageId)}"]`
      : `[id="${escapeAttr(initialEventId)}"]`;
    return scrollToEventTarget({
      listHandle: listHandle.current,
      index: idx,
      container,
      targetSelector,
      getStickyOffset: () => offsetTopRef.current ?? 0,
      paddingBelowSticky: kPaddingBelowSticky,
    });
  }, [initialEventId, initialMessageId, flattenedNodes, scrollRef]);

  useListKeyboardNavigation({
    listHandle,
    scrollRef,
    itemCount: flattenedNodes.length,
  });

  return (
    <StickyScrollProvider value={scrollRef ?? null}>
      <div
        style={
          {
            "--inspect-event-panel-sticky-top": `${offsetTop}px`,
          } as CSSProperties
        }
      >
        <TranscriptVirtualList
          id={id}
          listHandle={listHandle}
          eventNodes={flattenedNodes}
          scrollRef={scrollRef}
          running={running}
          offsetTop={offsetTop}
          className={clsx(className)}
          initialEventId={initialEventId}
          renderAgentCard={renderAgentCard}
          turnMap={computedTurnMap}
          eventCallbacks={eventCallbacks}
          eventNodeContext={mergedEventNodeContext}
        />
      </div>
    </StickyScrollProvider>
  );
});
