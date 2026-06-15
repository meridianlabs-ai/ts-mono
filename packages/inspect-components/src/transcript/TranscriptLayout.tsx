/**
 * Shared layout component for transcript views.
 *
 * Encapsulates the full visual structure: timeline swimlanes, transcript
 * outline, and virtualized event list. Apps provide events, selection
 * state adapters, and store-backed collapse callbacks.
 *
 * General behaviors that both apps benefit from:
 * - Message ID → event resolution (citation navigation)
 * - Bulk collapse/expand of all collapsible events
 * - Outline auto-hide when no displayable nodes exist
 * - Branch scroll target handling
 * - Empty state display
 */

import clsx from "clsx";
import {
  CSSProperties,
  FC,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  Event,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";
import { NoContentsPanel, StickyScroll } from "@tsmono/react/components";
import { useScrubberProgress } from "@tsmono/react/hooks";

import {
  findTimelineIndexForEvent,
  findTimelineIndexForMessage,
  timelineContainsEvent,
} from "./findTimelineForDeepLink";
import { useListPositionManager } from "./hooks/useListPositionManager";
import { useStickySwimLaneHeight } from "./hooks/useStickySwimLaneHeight";
import { TranscriptOutline } from "./outline/TranscriptOutline";
import {
  resolveEventInBranches,
  resolveEventToSpan,
  resolveMessageInBranches,
  resolveMessageToEvent,
} from "./resolveMessageToEvent";
import { useTranscriptSearchSource } from "./search";
import { AgentCardView, TimelineSwimLanes } from "./timeline/components";
import { spanHasBranches, type TimelineSpan } from "./timeline/core";
import {
  useEventNodes,
  useTimelineConfig,
  useTimelinesArray,
  useTranscriptTimeline,
  type TimelineOptions,
  type UseActiveTimelineProps,
  type UseTimelineProps,
} from "./timeline/hooks";
import { type MarkerConfig } from "./timeline/markers";
import {
  buildSpanSelectKeys,
  getSelectedSpans,
} from "./timeline/timelineEventNodes";
import {
  TimelineRowSelectContext,
  TimelineSelectContext,
} from "./TimelineSelectContext";
import styles from "./TranscriptLayout.module.css";
import {
  TranscriptViewNodes,
  type TranscriptViewNodesHandle,
} from "./TranscriptViewNodes";
import {
  EventNode,
  kCollapsibleEventTypes,
  kContentCollapsibleEventTypes,
  type EventNodeContext,
  type TranscriptCollapseState,
} from "./types";

// =============================================================================
// Types
// =============================================================================

export interface TranscriptLayoutOutlineProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  toggleDisabled?: boolean;
  toggleTitle?: string;
  toggleIcon: string;
  /** Header title shown next to the toggle icon when expanded. */
  title?: string;
  /** Name of the agent/subagent currently displayed. Shown as a header in the outline. */
  name?: string;
  renderLink?: (url: string, children: ReactNode) => ReactNode;
  onNavigateToEvent?: (eventId: string) => void;
  selectedId?: string | null;
  setSelectedId?: (id: string) => void;
}

export interface TranscriptLayoutRightPaneProps {
  /** Content shown when the pane is expanded. */
  content: ReactNode;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  toggleIcon: string;
  toggleTitle?: string;
  /** Header title shown next to the toggle icon when expanded. */
  title?: string;
  /** Width (px) when expanded. Defaults to 360. */
  width?: number;
  /** When provided, the pane is resizable: callback fires with the new width during drag. */
  onWidthChange?: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  /** aria-label root for the toggle / pane region. */
  label?: string;
}

export interface TranscriptLayoutProps {
  // --- Events ---
  events: Event[];
  /** Event types to hide from the rendered card list. Applied after timeline
   *  construction so structural events (anchor/branch) still resolve. */
  hiddenEventTypes?: readonly string[];
  /** Whether events are still being streamed (enables running indicators). */
  running?: boolean;

  // --- Scroll & positioning ---
  scrollRef: RefObject<HTMLDivElement | null>;
  offsetTop?: number;
  /** Size the layout to its content instead of filling the viewport. Use when
   *  embedding the transcript inside another scroll container (e.g. a card)
   *  rather than as the page's primary scroll region. */
  embedded?: boolean;

  // --- Timeline selection adapters ---
  timelineSelection?: UseTimelineProps;
  activeTimeline?: UseActiveTimelineProps;
  serverTimelines?: ServerTimeline[];

  // --- Timeline config overrides (default: useTimelineConfig()) ---
  markerConfig?: MarkerConfig;
  agentConfig?: TimelineOptions;

  // --- Swimlane control ---
  showSwimlanes?: boolean | "auto";
  onMarkerNavigate?: (eventId: string, selectedKey?: string) => void;
  onScrollToTop?: () => void;

  // --- Headroom ---
  headroomHidden?: boolean;
  /** Force the headroom into the given hidden state. Used by sources (e.g.
   *  search) that drive scroll-direction-sensitive UI when their motion
   *  doesn't match what the scroll-direction tracker would infer. */
  onHeadroomSetHidden?: (hidden: boolean) => void;
  onHeadroomResetAnchor?: (debounce?: boolean) => void;

  // --- Event list ---
  listId: string;
  /** Deep-link to a specific event on mount. Takes priority over initialMessageId. */
  initialEventId?: string | null;
  /** Deep-link to a message ID, resolved to the best matching event.
   *  Used for citation navigation — resolves against selected span first, then root. */
  initialMessageId?: string | null;
  eventsListRef?: RefObject<TranscriptViewNodesHandle | null>;
  getEventUrl?: (eventId: string) => string | undefined;
  linkingEnabled?: boolean;

  // --- Collapse state (from app store) ---
  /** Bulk collapse/expand of all collapsible events. Omit for no-op. */
  bulkCollapse?: "collapse" | "expand";
  collapseState?: TranscriptCollapseState;

  // --- Outline ---
  /** Outline panel configuration. When omitted, the outline column is hidden entirely. */
  outline?: TranscriptLayoutOutlineProps;
  /** Optional ref to the outline's sticky scroll container. Useful when the
   *  caller wants to observe its scroll events (e.g. headroom direction). */
  outlineScrollRef?: RefObject<HTMLDivElement | null>;

  // --- Right pane ---
  /** Optional right-side pane (mirror of outline). When omitted, the right column is hidden. */
  rightPane?: TranscriptLayoutRightPaneProps;
  /** Optional ref to the right pane's sticky scroll container. */
  rightPaneScrollRef?: RefObject<HTMLDivElement | null>;

  /** Extra context fields merged into every EventNodeContext entry. */
  eventNodeContext?: Partial<EventNodeContext>;

  /** Text shown when no events match the current filter. Pass null to disable empty state. */
  emptyText?: string | null;
  /** Render the empty state as an in-progress placeholder (animated, no icon). */
  emptyBusy?: boolean;
  className?: string;
}

// =============================================================================
// Helpers
// =============================================================================

const collectAllCollapsibleIds = (
  nodes: EventNode[]
): Record<string, boolean> => {
  const result: Record<string, boolean> = {};
  const traverse = (nodeList: EventNode[]) => {
    for (const node of nodeList) {
      if (
        kCollapsibleEventTypes.includes(node.event.event) ||
        kContentCollapsibleEventTypes.includes(node.event.event)
      ) {
        result[node.id] = true;
      }
      if (node.children.length > 0) {
        traverse(node.children);
      }
    }
  };
  traverse(nodes);
  return result;
};

const buildToolLabels = (
  events: Event[],
  messageLabels: Record<string, string> | undefined
): Record<string, string> | undefined => {
  if (!messageLabels) return undefined;

  const toolLabels: Record<string, string> = {};
  for (const event of events) {
    if (event.event === "tool") {
      const label = event.message_id
        ? messageLabels[event.message_id]
        : undefined;
      if (label) toolLabels[event.id] = label;
    } else if (event.event === "model") {
      for (const message of event.input ?? []) {
        if (message.role !== "tool" || !message.id) continue;
        const label = messageLabels[message.id];
        if (label && message.tool_call_id) {
          toolLabels[message.tool_call_id] = label;
        }
      }
    }
  }

  return Object.keys(toolLabels).length > 0 ? toolLabels : undefined;
};

// Restrict the message-label map to messages actually present in `events`.
// The map is shared across the whole sample, but timelines (e.g. auditor vs
// target) show different events — without this an unlabeled timeline would
// reserve label-column space just because another timeline is labeled.
const scopeMessageLabels = (
  events: Event[],
  messageLabels: Record<string, string> | undefined
): Record<string, string> | undefined => {
  if (!messageLabels) return undefined;

  const present = new Set<string>();
  for (const event of events) {
    if (event.event === "model") {
      for (const message of event.input ?? []) {
        if (message.id) present.add(message.id);
      }
      for (const choice of event.output?.choices ?? []) {
        if (choice.message?.id) present.add(choice.message.id);
      }
    } else if (event.event === "tool" && event.message_id) {
      present.add(event.message_id);
    }
  }

  const scoped: Record<string, string> = {};
  for (const [id, label] of Object.entries(messageLabels)) {
    if (present.has(id)) scoped[id] = label;
  }
  return Object.keys(scoped).length > 0 ? scoped : undefined;
};

// =============================================================================
// Component
// =============================================================================

export const TranscriptLayout: FC<TranscriptLayoutProps> = ({
  events,
  hiddenEventTypes,
  running = false,
  scrollRef,
  offsetTop = 0,
  embedded = false,
  timelineSelection,
  activeTimeline,
  serverTimelines,
  markerConfig: markerConfigOverride,
  agentConfig: agentConfigOverride,
  showSwimlanes: showSwimlanesOption = "auto",
  onMarkerNavigate,
  onScrollToTop,
  headroomHidden,
  onHeadroomResetAnchor,
  onHeadroomSetHidden,
  listId,
  initialEventId,
  initialMessageId,
  eventsListRef,
  getEventUrl,
  linkingEnabled,
  bulkCollapse,
  collapseState,
  outline,
  outlineScrollRef,
  rightPane,
  rightPaneScrollRef,
  eventNodeContext,
  emptyText = "No events match the current filter",
  emptyBusy,
  className,
}) => {
  // ---------------------------------------------------------------------------
  // Timeline-pipeline events
  // ---------------------------------------------------------------------------

  // Apply the user's event-type filter to the timeline pipeline so hidden
  // types don't leave behind empty swimlane rows (e.g. an "init" span whose
  // only content was a filtered `sample_init`). `anchor` events are always
  // preserved — they're structural references used by `convertServerTimeline`
  // to position fork navigators, not display content.
  const eventsForTimeline = useMemo(() => {
    if (!hiddenEventTypes || hiddenEventTypes.length === 0) return events;
    return events.filter(
      (e) => e.event === "anchor" || !hiddenEventTypes.includes(e.event)
    );
  }, [events, hiddenEventTypes]);

  // ---------------------------------------------------------------------------
  // Timeline config (persistent user preferences)
  // ---------------------------------------------------------------------------

  // Detect whether any timeline in this sample contains branches so the
  // config hook can default `showBranches` on (when the user has not
  // explicitly toggled it). `useTimelinesArray` is memoized, so the redundant
  // call inside `useTranscriptTimeline` below reuses the same result.
  const timelinesForBranchDetection = useTimelinesArray(
    eventsForTimeline,
    serverTimelines
  );
  const branchesPresent = useMemo(
    () => timelinesForBranchDetection.some((tl) => spanHasBranches(tl.root)),
    [timelinesForBranchDetection]
  );

  const timelineConfig = useTimelineConfig({ branchesPresent });
  const resolvedMarkerConfig =
    markerConfigOverride ?? timelineConfig.markerConfig;
  const resolvedAgentConfig = agentConfigOverride ?? timelineConfig.agentConfig;

  // ---------------------------------------------------------------------------
  // Timeline pipeline
  // ---------------------------------------------------------------------------

  const {
    timeline: timelineData,
    state: timelineState,
    layouts: timelineLayouts,
    rootTimeMapping,
    selectedEvents,
    sourceSpans,
    minimapSelection,
    hasTimeline,
    hasAgentTimeline,
    timelines,
    activeTimelineIndex,
    setActiveTimeline,
    regionCounts,
    branchScrollTarget,
    highlightedKeys,
    selectedRowName,
    viewStack,
    pushView,
    popView,
  } = useTranscriptTimeline({
    events: eventsForTimeline,
    markerConfig: resolvedMarkerConfig,
    timelineOptions: resolvedAgentConfig,
    serverTimelines,
    timelineProps: timelineSelection,
    activeTimelineProps: activeTimeline,
  });

  // ---------------------------------------------------------------------------
  // Swimlane visibility
  // ---------------------------------------------------------------------------

  const showSwimlanes = useMemo(() => {
    if (showSwimlanesOption === "auto") {
      return hasTimeline || regionCounts.size > 0 || timelines.length > 1;
    }
    return showSwimlanesOption;
  }, [showSwimlanesOption, hasTimeline, regionCounts, timelines.length]);

  const swimlanesDefaultCollapsed = useMemo(() => {
    if (
      showSwimlanesOption === "auto" &&
      !hasTimeline &&
      regionCounts.size === 0
    ) {
      return true;
    }
    if (hasTimeline) {
      // Expand by default only when there's agent sub-structure to drill into.
      // A bare main + scoring (or init) timeline has nothing to expand, so
      // default it collapsed.
      return hasAgentTimeline ? false : true;
    }
    return undefined;
  }, [showSwimlanesOption, hasTimeline, hasAgentTimeline, regionCounts]);

  // ---------------------------------------------------------------------------
  // Event nodes
  // ---------------------------------------------------------------------------

  const rawEventsForNodes = showSwimlanes ? selectedEvents : events;
  const eventsForNodes = useMemo(
    () =>
      hiddenEventTypes && hiddenEventTypes.length > 0
        ? rawEventsForNodes.filter((e) => !hiddenEventTypes.includes(e.event))
        : rawEventsForNodes,
    [rawEventsForNodes, hiddenEventTypes]
  );
  const { eventNodes, defaultCollapsedIds, retryAttempts } = useEventNodes(
    eventsForNodes,
    running,
    showSwimlanes ? sourceSpans : undefined
  );

  const mergedEventNodeContext = useMemo<Partial<EventNodeContext>>(() => {
    const messageLabels = scopeMessageLabels(
      eventsForNodes,
      eventNodeContext?.messageLabels
    );
    const toolLabels = buildToolLabels(eventsForNodes, messageLabels);
    return {
      ...eventNodeContext,
      messageLabels,
      retryAttempts,
      ...(toolLabels ? { toolLabels } : {}),
    };
  }, [eventsForNodes, eventNodeContext, retryAttempts]);

  const nullViewNodesRef = useRef<TranscriptViewNodesHandle | null>(null);

  // Honor the same event-type filter the renderer uses. State/store events
  // carry huge JSON payloads but aren't surfaced in the transcript tree;
  // matching their fields would inflate the counter with unreachable results.
  const searchableEvents = useMemo(() => {
    if (!hiddenEventTypes || hiddenEventTypes.length === 0) return events;
    const hidden = new Set(hiddenEventTypes);
    return events.filter((e) => !hidden.has(e.event));
  }, [events, hiddenEventTypes]);

  useTranscriptSearchSource({
    id: listId,
    events: searchableEvents,
    rows: timelineState.rows,
    selected: timelineSelection?.selected ?? null,
    onSelect: timelineSelection?.onSelect ?? (() => {}),
    viewNodesRef: eventsListRef ?? nullViewNodesRef,
    onHeadroomResetAnchor,
    onHeadroomSetHidden,
  });

  // ---------------------------------------------------------------------------
  // Sticky swimlane height
  // ---------------------------------------------------------------------------

  const {
    stickySwimLaneHeight,
    isSwimLaneSticky,
    swimLaneStickyContentRef,
    handleSwimLaneStickyChange,
  } = useStickySwimLaneHeight();

  const effectiveOffsetTop = offsetTop + stickySwimLaneHeight;

  // ---------------------------------------------------------------------------
  // Per-agent list position management
  // ---------------------------------------------------------------------------

  // Suppress the scroll-to-top on selection change when an active deep-link
  // target is in URL. The URL-driven case is sync (the URL update lands
  // before the row-click effects fire, so a top reset would clobber the
  // about-to-fire imperative scroll). For pure swimlane row clicks (URL
  // bare, only `branchScrollTarget` set), keeping the top reset is
  // desirable — it clears the previous branch's deep scroll position
  // before the imperative scroll lands on the new branch separator.
  // The imperative scroll runs in rAF and re-scrolls to its target after
  // the sync top reset.
  // Scroll-anchor for inline fork-navigator clicks: the prefix above the
  // clicked navigator is unchanged across the selection, so capturing and
  // restoring scrollTop keeps the navigator at the same viewport position.
  const [scrollAnchor, setScrollAnchor] = useState<{
    scrollTop: number;
  } | null>(null);
  const hasScrollTarget = !!(
    initialEventId ||
    initialMessageId ||
    scrollAnchor
  );
  const { effectiveListId } = useListPositionManager(
    listId,
    timelineState.selected,
    scrollRef,
    hasScrollTarget
  );

  // ---------------------------------------------------------------------------
  // Scrubber progress
  // ---------------------------------------------------------------------------

  const [scrubberProgress, scrubTo] = useScrubberProgress(scrollRef);

  const handleScrub = useCallback(
    (progress: number) => {
      onHeadroomResetAnchor?.(true);
      scrubTo(progress);
    },
    [onHeadroomResetAnchor, scrubTo]
  );

  const swimlaneHeader = useMemo(
    () => ({
      rootLabel: timelineData.root.name,
      onScrollToTop,
      minimap: {
        root: timelineData.root,
        selection: minimapSelection,
        mapping: rootTimeMapping,
        scrubberProgress,
        onScrub: handleScrub,
      },
      timelineConfig,
      timelineSelector:
        timelines.length > 1
          ? {
              timelines,
              activeIndex: activeTimelineIndex,
              onSelect: setActiveTimeline,
            }
          : undefined,
      viewStack,
      onPopView: popView,
    }),
    [
      timelineData.root,
      onScrollToTop,
      minimapSelection,
      rootTimeMapping,
      scrubberProgress,
      handleScrub,
      timelineConfig,
      timelines,
      activeTimelineIndex,
      setActiveTimeline,
      viewStack,
      popView,
    ]
  );

  const handlePunchDown = useCallback(
    (rowKey: string, label: string) => {
      const row = timelineState.rows.find((r) => r.key === rowKey);
      const span = row?.spans[0];
      if (span && "agent" in span) pushView(span.agent, label);
    },
    [timelineState.rows, pushView]
  );

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
      timelineState.select(key.key);
    },
    [spanSelectKeys, timelineState]
  );

  const selectByRowKey = useCallback(
    (rowKey: string, anchorEl?: HTMLElement) => {
      if (anchorEl && scrollRef.current) {
        setScrollAnchor({ scrollTop: scrollRef.current.scrollTop });
      }
      timelineState.select(rowKey, { preserveScroll: true });
    },
    [timelineState, scrollRef]
  );

  // ---------------------------------------------------------------------------
  // Message ID → event resolution
  // ---------------------------------------------------------------------------

  // Resolve message ID against the selected span first, then fall back to root.
  const resolvedLocal = useMemo(() => {
    if (initialEventId || !initialMessageId) return undefined;
    const selectedSpans = getSelectedSpans(
      timelineState.rows,
      timelineState.selected
    );
    for (const span of selectedSpans) {
      const result = resolveMessageToEvent(initialMessageId, span);
      if (result && !result.agentSpanId) return result;
    }
    return undefined;
  }, [
    initialEventId,
    initialMessageId,
    timelineState.rows,
    timelineState.selected,
  ]);

  const resolvedRoot = useMemo(() => {
    if (initialEventId || !initialMessageId || resolvedLocal) return undefined;
    // First try the main content tree (existing behavior).
    const main = resolveMessageToEvent(initialMessageId, timelineData.root);
    if (main) return main;
    // Fall back to branches: walk every branch in the tree and return the
    // first match in swimlane row order (latest fork first).
    return resolveMessageInBranches(initialMessageId, timelineData.root);
  }, [initialEventId, initialMessageId, resolvedLocal, timelineData.root]);

  const resolved = resolvedLocal ?? resolvedRoot;

  // Cross-timeline deep links: if the target lives in a different root
  // timeline, find it so the effect below can switch to it. -1 = no switch.
  const deepLinkTimelineIndex = useMemo(() => {
    if (timelines.length <= 1) return -1;
    if (initialEventId) {
      const active = timelines[activeTimelineIndex];
      if (!active || timelineContainsEvent(initialEventId, active)) return -1;
      return findTimelineIndexForEvent(initialEventId, timelines);
    }
    if (initialMessageId && !resolvedLocal && !resolvedRoot) {
      return findTimelineIndexForMessage(initialMessageId, timelines);
    }
    return -1;
  }, [
    initialEventId,
    initialMessageId,
    resolvedLocal,
    resolvedRoot,
    timelines,
    activeTimelineIndex,
  ]);

  // Side-effect: switch swimlane selection when resolution comes from root
  // (i.e. requires moving the user to a different row to see the resolved
  // event). Calls `timelineState.select` with `{ preserveDeepLink: true }`
  // so hosts know to keep the URL `?message=` / `?event=` params intact
  // rather than clearing them as they would for a user row click — the
  // imperative scroll about to fire still needs the deep-link target.
  //
  // Gated on `initialMessageId` actually changing — selection-only changes
  // (user clicked a swimlane row) cause `resolvedRoot` to recompute against
  // the still-stale URL message during the intermediate render before URL
  // clearing is applied; firing the side effect there would override the
  // user's just-expressed selection intent.
  const prevMessageIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevMessageIdRef.current === initialMessageId) return;
    // A cross-timeline switch is pending: don't consume the message id yet —
    // this effect must re-evaluate after the switch lands and resolution
    // re-runs against the new root.
    if (deepLinkTimelineIndex >= 0) return;
    prevMessageIdRef.current = initialMessageId;
    if (!resolvedRoot) return;
    let targetKey: string | null = null;
    if (resolvedRoot.branchRowKey) {
      targetKey = resolvedRoot.branchRowKey;
    } else if (resolvedRoot.agentSpanId) {
      targetKey = spanSelectKeys.get(resolvedRoot.agentSpanId)?.key ?? null;
    }
    if (timelineState.selected === targetKey) return;
    timelineState.select(targetKey, { preserveDeepLink: true });
  }, [
    initialMessageId,
    deepLinkTimelineIndex,
    resolvedRoot,
    spanSelectKeys,
    timelineState,
  ]);

  // Fire the timeline switch once per deep-link change — a stale `?event=` /
  // `?message=` param left in the URL must not snap the user back after they
  // manually switch timelines away.
  //
  // Mark the key "consumed" only once we've actually switched. While the
  // target isn't found yet (index -1 — e.g. timeline data still building or
  // events still streaming), leave it unconsumed so a later data update with
  // the same key can still trigger the switch. The snap-back guard still
  // holds: after a switch, the target resolves in the now-active timeline,
  // so `deepLinkTimelineIndex` drops to -1 and the consumed key blocks any
  // re-switch even if the user navigates timelines manually.
  const prevDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (timelines.length <= 1) return;
    const key = initialEventId ?? initialMessageId ?? null;
    if (key === null) {
      prevDeepLinkRef.current = null;
      return;
    }
    if (prevDeepLinkRef.current === key) return;
    if (deepLinkTimelineIndex < 0) return;
    prevDeepLinkRef.current = key;
    if (deepLinkTimelineIndex === activeTimelineIndex) return;
    setActiveTimeline(deepLinkTimelineIndex);
  }, [
    initialEventId,
    initialMessageId,
    deepLinkTimelineIndex,
    activeTimelineIndex,
    setActiveTimeline,
    timelines.length,
  ]);

  // Event deep links targeting a non-visible swimlane lane: with swimlanes
  // on, the event list only contains the selected rows' events, so a target
  // in another agent lane (or branch) is unreachable until that row is
  // selected. The event-id analogue of the message side-effect above.
  const resolvedEventSpan = useMemo(() => {
    if (!initialEventId || !showSwimlanes) return undefined;
    const present = eventsForNodes.some(
      (e) => (e as { uuid?: string | null }).uuid === initialEventId
    );
    if (present) return undefined;
    return (
      resolveEventToSpan(initialEventId, timelineData.root) ??
      resolveEventInBranches(initialEventId, timelineData.root)
    );
  }, [initialEventId, showSwimlanes, eventsForNodes, timelineData.root]);

  const prevEventIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevEventIdRef.current === initialEventId) return;
    // A cross-timeline switch is pending: re-evaluate after it lands.
    if (deepLinkTimelineIndex >= 0) return;
    prevEventIdRef.current = initialEventId;
    if (!resolvedEventSpan) return;
    let targetKey: string | null = null;
    if (resolvedEventSpan.branchRowKey) {
      targetKey = resolvedEventSpan.branchRowKey;
    } else if (resolvedEventSpan.agentSpanId) {
      targetKey =
        spanSelectKeys.get(resolvedEventSpan.agentSpanId)?.key ?? null;
    }
    if (!targetKey) return;
    if (timelineState.selected === targetKey) return;
    timelineState.select(targetKey, { preserveDeepLink: true });
  }, [
    initialEventId,
    deepLinkTimelineIndex,
    resolvedEventSpan,
    spanSelectKeys,
    timelineState,
  ]);

  const effectiveInitialEventId =
    initialEventId ?? resolved?.eventId ?? branchScrollTarget ?? null;

  // Branch selections share one effectiveListId (no remount), so the prefix
  // above the clicked navigator is laid out identically — restoring scrollTop
  // keeps it at the same viewport position.
  useEffect(() => {
    if (!scrollAnchor) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollAnchor.scrollTop });
    });
  }, [scrollAnchor, scrollRef]);

  // Suppress headroom (swimlane collapse/expand) during programmatic scrolls
  // — fires for any change to the effective scroll target (URL `?event=`,
  // resolved message, branch switch). The reset-anchor uses a debounced
  // lock that stays active while the imperative scroll's retry loop keeps
  // emitting scroll events, so the swimlane doesn't flicker open/closed
  // during the multi-pass settling.
  useEffect(() => {
    if (effectiveInitialEventId) {
      onHeadroomResetAnchor?.(true);
    }
  }, [effectiveInitialEventId, onHeadroomResetAnchor]);

  // ---------------------------------------------------------------------------
  // Bulk collapse/expand
  // ---------------------------------------------------------------------------

  const onSetTranscriptCollapsed = collapseState?.onSetTranscriptCollapsed;
  useEffect(() => {
    if (events.length <= 0 || !bulkCollapse || !onSetTranscriptCollapsed) {
      return;
    }
    if (bulkCollapse === "expand") {
      onSetTranscriptCollapsed({});
    } else if (bulkCollapse === "collapse") {
      const allCollapsibleIds = collectAllCollapsibleIds(eventNodes);
      onSetTranscriptCollapsed(allCollapsibleIds);
    }
  }, [eventNodes, bulkCollapse, onSetTranscriptCollapsed, events.length]);

  // Lazy-seed: when the user toggles an individual node for the first time
  // (store scope is empty), seed the store with defaults before applying the
  // toggle so that all other nodes retain their default collapsed state.
  const onCollapseTranscriptRaw = collapseState?.onCollapseTranscript;
  const onCollapseTranscript = useCallback(
    (nodeId: string, collapsed: boolean) => {
      if (!onCollapseTranscriptRaw || !onSetTranscriptCollapsed) return;
      if (!collapseState?.transcript) {
        // First toggle — seed defaults then apply the toggle
        onSetTranscriptCollapsed({
          ...defaultCollapsedIds,
          [nodeId]: collapsed,
        });
      } else {
        onCollapseTranscriptRaw(nodeId, collapsed);
      }
    },
    [
      onCollapseTranscriptRaw,
      onSetTranscriptCollapsed,
      collapseState?.transcript,
      defaultCollapsedIds,
    ]
  );

  // Bulk-expand for deep links into collapsed regions. One batched update —
  // sequential onCollapseTranscript calls would each re-seed defaults and
  // clobber the previous call's expansion while the store is unseeded.
  const onExpandNodes = useCallback(
    (nodeIds: string[]) => {
      if (!onSetTranscriptCollapsed) return;
      const next = { ...(collapseState?.transcript ?? defaultCollapsedIds) };
      for (const id of nodeIds) next[id] = false;
      onSetTranscriptCollapsed(next);
    },
    [onSetTranscriptCollapsed, collapseState?.transcript, defaultCollapsedIds]
  );

  // ---------------------------------------------------------------------------
  // Outline auto-hide
  // ---------------------------------------------------------------------------
  //
  // Track whether the outline component reports displayable nodes. When the
  // outline is collapsed (unmounted), it can't report, so we optimistically
  // fall back to eventNodes.length > 0 to keep the toggle enabled.
  //
  // Auto-hide the outline when content has no nodes (e.g. utility agent)
  // without touching the user's persistent preference. When the user navigates
  // back to an agent with outline content, the preference is still intact.

  const [reportedHasNodes, setReportedHasNodes] = useState(true);

  // Reset to optimistic when eventNodes change (e.g. agent selection changes).
  // Uses "adjust state during render" pattern to avoid an extra effect cycle.
  const [prevEventNodes, setPrevEventNodes] = useState(eventNodes);
  if (prevEventNodes !== eventNodes) {
    setPrevEventNodes(eventNodes);
    if (!reportedHasNodes) {
      setReportedHasNodes(true);
    }
  }

  const hasMatchingEvents = eventNodes.length > 0;
  const autoHidden = outline ? !reportedHasNodes && !outline.collapsed : false;
  const isOutlineCollapsed = !outline || outline.collapsed || autoHidden;

  const outlineHasNodes = isOutlineCollapsed
    ? hasMatchingEvents
    : reportedHasNodes;
  const handleOutlineHasNodesChange = useCallback((hasNodes: boolean) => {
    setReportedHasNodes(hasNodes);
  }, []);

  // ---------------------------------------------------------------------------
  // Agent card rendering
  // ---------------------------------------------------------------------------

  const renderAgentCard = useCallback(
    (node: EventNode, agentCardClassName?: string) => {
      const span = node.sourceSpan as TimelineSpan | undefined;
      if (!span) return null;
      return <AgentCardView span={span} className={agentCardClassName} />;
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Headroom reset anchor
  // ---------------------------------------------------------------------------

  const handleLayoutShift = useCallback(
    (debounce?: boolean) => onHeadroomResetAnchor?.(debounce),
    [onHeadroomResetAnchor]
  );

  // When a sidebar toggles, the layout reflows but no scroll/resize event
  // fires — so sticky-state observers (useStickyObserver, StickyScroll)
  // keep stale state. Dispatch a synthetic scroll event after the DOM has
  // settled to force them to re-measure.
  const outlineCollapsedFlag = outline?.collapsed ?? null;
  const rightPaneCollapsedFlag = rightPane?.collapsed ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const timer = setTimeout(() => {
      el.dispatchEvent(new Event("scroll"));
    }, 0);
    return () => clearTimeout(timer);
  }, [outlineCollapsedFlag, rightPaneCollapsedFlag, scrollRef]);

  // Forward wheel events from the sidebars to the main scroll container
  // only while the header above the tabs is still visible. Once the sidebar
  // is stuck at its sticky top (header fully out), wheel events stop chaining
  // so the main transcript doesn't scroll along with the sidebar.
  const effectiveOffsetTopRef = useRef(effectiveOffsetTop);
  useEffect(() => {
    effectiveOffsetTopRef.current = effectiveOffsetTop;
  }, [effectiveOffsetTop]);

  useEffect(() => {
    const main = scrollRef.current;
    const outlineEl = outlineScrollRef?.current ?? null;
    const rightEl = rightPaneScrollRef?.current ?? null;
    if (!main) return;

    const makeHandler = (sidebar: HTMLDivElement) => (e: WheelEvent) => {
      const mainMaxTop = main.scrollHeight - main.clientHeight;
      // Is the sidebar currently stuck at its sticky top? If so, the header
      // above the tabs has already scrolled off — don't chain further main
      // scrolling or the transcript itself would move with the sidebar.
      const mainRect = main.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const sidebarTopInScroller = sidebarRect.top - mainRect.top;
      const sidebarIsSticky =
        sidebarTopInScroller <= effectiveOffsetTopRef.current + 1;

      if (!sidebarIsSticky) {
        // Header still visible — forward all wheel input to the main
        // scroller so that the header collapses/expands. Suppress the
        // sidebar's default scroll for this step.
        const canMain =
          (e.deltaY > 0 && main.scrollTop < mainMaxTop - 0.5) ||
          (e.deltaY < 0 && main.scrollTop > 0.5);
        if (canMain) {
          e.preventDefault();
          main.scrollBy({ top: e.deltaY, behavior: "auto" });
        }
      } else if (e.deltaY < 0 && sidebar.scrollTop <= 0 && main.scrollTop > 0) {
        // Sidebar is sticky and already at its own top — wheeling up should
        // bring the header back, so forward to main.
        e.preventDefault();
        main.scrollBy({ top: e.deltaY, behavior: "auto" });
      }
      // Otherwise let the sidebar's native wheel scroll proceed.
    };

    const targets = [outlineEl, rightEl].filter(
      (el): el is HTMLDivElement => el != null
    );
    const entries = targets.map((t) => {
      const handler = makeHandler(t);
      // passive: false so we can preventDefault when taking over the scroll.
      t.addEventListener("wheel", handler, { passive: false });
      return { t, handler };
    });
    return () => {
      for (const { t, handler } of entries) {
        t.removeEventListener("wheel", handler);
      }
    };
  }, [
    scrollRef,
    outlineScrollRef,
    rightPaneScrollRef,
    // Re-attach when collapse state changes (the scroll elements may have
    // unmounted/remounted via the conditional render).
    outlineCollapsedFlag,
    rightPaneCollapsedFlag,
  ]);

  // Track the scroll container's visible height so sticky sidebars can cap
  // their max-height to the actually-visible area (100vh would include the
  // app navbar above the scroll container, leaving content unreachable).
  // Use getBoundingClientRect().height — this matches what's actually on
  // screen (clientHeight can report slightly different values depending on
  // scrollbar / box-sizing quirks).
  // Capture the outline's own scroll container (the StickyScroll div, which
  // has overflow-y:auto) into state so the outline's Virtuoso can use it as
  // its scroll parent. Resolving into state (rather than reading a ref during
  // render) guarantees a re-render once the element mounts. Also mirror it
  // into the optional external ref callers pass for wheel forwarding.
  const [outlineScrollEl, setOutlineScrollEl] = useState<HTMLDivElement | null>(
    null
  );
  const handleOutlineScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      setOutlineScrollEl(el);
      if (outlineScrollRef) {
        outlineScrollRef.current = el;
      }
    },
    [outlineScrollRef]
  );

  const [scrollerHeight, setScrollerHeight] = useState<number>(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrollerHeight(el.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [scrollRef]);

  // ---------------------------------------------------------------------------
  // Right pane resize
  // ---------------------------------------------------------------------------

  const rightPaneWidth = rightPane?.width ?? 360;
  const rightPaneMinWidth = rightPane?.minWidth ?? 240;
  const rightPaneMaxWidth = rightPane?.maxWidth ?? 800;
  const rightPaneOnWidthChange = rightPane?.onWidthChange;
  const rightPaneDragRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleRightPanePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!rightPaneOnWidthChange) return;
      e.preventDefault();
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
      rightPaneDragRef.current = {
        startX: e.clientX,
        startWidth: rightPaneWidth,
      };
    },
    [rightPaneOnWidthChange, rightPaneWidth]
  );

  const handleRightPanePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!rightPaneOnWidthChange || !rightPaneDragRef.current) return;
      const { startX, startWidth } = rightPaneDragRef.current;
      const next = startWidth - (e.clientX - startX);
      const clamped = Math.max(
        rightPaneMinWidth,
        Math.min(rightPaneMaxWidth, next)
      );
      rightPaneOnWidthChange(clamped);
    },
    [rightPaneOnWidthChange, rightPaneMinWidth, rightPaneMaxWidth]
  );

  const handleRightPanePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      rightPaneDragRef.current = null;
      try {
        (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        // pointer may already be released
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <TimelineSelectContext.Provider value={selectBySpanId}>
      <TimelineRowSelectContext.Provider value={selectByRowKey}>
        <div className={clsx(styles.root, className)}>
          {showSwimlanes && (
            <StickyScroll
              scrollRef={scrollRef}
              offsetTop={offsetTop}
              zIndex={500}
              preserveHeight={true}
              onStickyChange={handleSwimLaneStickyChange}
            >
              <div ref={swimLaneStickyContentRef}>
                <TimelineSwimLanes
                  layouts={timelineLayouts}
                  timeline={timelineState}
                  header={swimlaneHeader}
                  onMarkerNavigate={onMarkerNavigate}
                  isSticky={isSwimLaneSticky}
                  headroomCollapsed={!!headroomHidden && isSwimLaneSticky}
                  onLayoutShift={handleLayoutShift}
                  defaultCollapsed={swimlanesDefaultCollapsed}
                  regionCounts={regionCounts}
                  highlightedKeys={highlightedKeys}
                  onPunchDown={handlePunchDown}
                />
              </div>
            </StickyScroll>
          )}
          <div
            className={clsx(
              styles.container,
              embedded && styles.embedded,
              !outline && styles.noOutline,
              outline && isOutlineCollapsed && styles.outlineCollapsed,
              !rightPane && styles.noRightPane,
              rightPane && rightPane.collapsed && styles.rightPaneCollapsed
            )}
            style={
              {
                "--outline-top": `${effectiveOffsetTop}px`,
                "--right-pane-width": `${rightPaneWidth}px`,
                "--scroller-height": scrollerHeight
                  ? `${scrollerHeight}px`
                  : "100vh",
              } as CSSProperties
            }
          >
            {outline && (
              <>
                <StickyScroll
                  ref={handleOutlineScrollRef}
                  scrollRef={scrollRef}
                  className={styles.outline}
                  offsetTop={effectiveOffsetTop}
                >
                  {!isOutlineCollapsed ? (
                    <>
                      {outline.title && (
                        <div className={styles.sidebarHeader}>
                          <span
                            className={clsx(
                              styles.sidebarHeaderTitle,
                              "text-size-smaller"
                            )}
                          >
                            {outline.title}
                          </span>
                        </div>
                      )}
                      <div className={styles.sidebarHeaderCloseAnchor}>
                        <button
                          type="button"
                          className={styles.sidebarHeaderClose}
                          onClick={() => outline.onCollapsedChange(true)}
                          aria-label="Hide outline"
                          title={outline.toggleTitle ?? "Hide outline"}
                        >
                          <i className="bi bi-x" />
                        </button>
                      </div>
                      <TranscriptOutline
                        eventNodes={eventNodes}
                        defaultCollapsedIds={defaultCollapsedIds}
                        scrollRef={scrollRef}
                        outlineScrollEl={outlineScrollEl}
                        running={running}
                        agentName={
                          outline.name ??
                          (showSwimlanes ? selectedRowName : undefined)
                        }
                        scrollTrackOffset={effectiveOffsetTop}
                        getCollapsed={
                          collapseState?.outline
                            ? (nodeId: string) =>
                                collapseState.outline?.[nodeId] === true
                            : undefined
                        }
                        setCollapsed={collapseState?.onCollapseOutline}
                        collapsedEvents={collapseState?.outline}
                        setCollapsedEvents={
                          collapseState?.onSetOutlineCollapsed
                        }
                        selectedOutlineId={outline.selectedId}
                        setSelectedOutlineId={outline.setSelectedId}
                        getEventUrl={getEventUrl}
                        renderLink={outline.renderLink}
                        onNavigateToEvent={outline.onNavigateToEvent}
                        onHasNodesChange={handleOutlineHasNodesChange}
                      />
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.outlineToggle}
                      onClick={
                        outlineHasNodes && !outline.toggleDisabled
                          ? () => outline.onCollapsedChange(false)
                          : undefined
                      }
                      aria-disabled={outline.toggleDisabled || !outlineHasNodes}
                      title={
                        outline.toggleTitle ??
                        (!outlineHasNodes
                          ? "No outline available for the current filter"
                          : undefined)
                      }
                      aria-label="Show outline"
                    >
                      <i className={outline.toggleIcon} />
                    </button>
                  )}
                </StickyScroll>
                <div className={styles.separator} />
              </>
            )}
            {hasMatchingEvents ? (
              <TranscriptViewNodes
                key={effectiveListId}
                ref={eventsListRef}
                id={effectiveListId}
                eventNodes={eventNodes}
                defaultCollapsedIds={defaultCollapsedIds}
                running={running}
                initialEventId={effectiveInitialEventId}
                initialMessageId={initialMessageId}
                offsetTop={effectiveOffsetTop}
                className={styles.eventsList}
                scrollRef={scrollRef}
                renderAgentCard={showSwimlanes ? renderAgentCard : undefined}
                getEventUrl={getEventUrl}
                linkingEnabled={linkingEnabled}
                collapsedTranscript={collapseState?.transcript}
                collapsedOutline={collapseState?.outline}
                onCollapseTranscript={onCollapseTranscript}
                onExpandNodes={
                  onSetTranscriptCollapsed ? onExpandNodes : undefined
                }
                eventNodeContext={mergedEventNodeContext}
              />
            ) : emptyText !== null ? (
              <NoContentsPanel text={emptyText} busy={emptyBusy} />
            ) : null}
            {rightPane && (
              <>
                <div className={styles.rightSeparator} />
                <StickyScroll
                  ref={rightPaneScrollRef}
                  scrollRef={scrollRef}
                  className={styles.rightPane}
                  offsetTop={effectiveOffsetTop}
                >
                  {!rightPane.collapsed ? (
                    <>
                      {rightPaneOnWidthChange && (
                        <div
                          className={styles.rightPaneResizer}
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${rightPane.label ?? "pane"}`}
                          onPointerDown={handleRightPanePointerDown}
                          onPointerMove={handleRightPanePointerMove}
                          onPointerUp={handleRightPanePointerUp}
                          onPointerCancel={handleRightPanePointerUp}
                        />
                      )}
                      {rightPane.title && (
                        <div className={styles.sidebarHeader}>
                          <span
                            className={clsx(
                              styles.sidebarHeaderTitle,
                              "text-size-smaller"
                            )}
                          >
                            {rightPane.title}
                          </span>
                        </div>
                      )}
                      <div className={styles.sidebarHeaderCloseAnchor}>
                        <button
                          type="button"
                          className={styles.sidebarHeaderClose}
                          onClick={() => rightPane.onCollapsedChange(true)}
                          aria-label={`Hide ${rightPane.label ?? "pane"}`}
                          title={
                            rightPane.toggleTitle ??
                            `Hide ${rightPane.label ?? "pane"}`
                          }
                        >
                          <i className="bi bi-x" />
                        </button>
                      </div>
                      {rightPane.content}
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.rightPaneToggle}
                      onClick={() => rightPane.onCollapsedChange(false)}
                      title={
                        rightPane.toggleTitle ??
                        `Show ${rightPane.label ?? "pane"}`
                      }
                      aria-label={`Show ${rightPane.label ?? "pane"}`}
                    >
                      <i className={rightPane.toggleIcon} />
                    </button>
                  )}
                </StickyScroll>
              </>
            )}
          </div>
        </div>
      </TimelineRowSelectContext.Provider>
    </TimelineSelectContext.Provider>
  );
};
