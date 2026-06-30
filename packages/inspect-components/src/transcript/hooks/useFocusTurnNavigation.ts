import { useCallback, useMemo, useRef, type RefObject } from "react";

import { useListKeyboardNavigation } from "@tsmono/react/hooks";
import type { VirtualListHandle } from "@tsmono/react/virtual";

import type { FocusTabValue } from "../FocusTabContext";
import type { TurnInfo } from "../outline/tree-visitors";
import { flatTree } from "../transform/flatten";
import { computeAgentLanes, focusedTurnNodes } from "../turnNavigation";
import type { EventNode } from "../types";

export interface FocusTurnNavigation {
  scrollRef: RefObject<HTMLDivElement | null>;
  listHandle: RefObject<VirtualListHandle | null>;
  /** The focused turn's events (model + its tools), fully expanded. */
  slice: EventNode[];
  /** Turn number/total within the focused event's agent lane. */
  turnInfo: TurnInfo | undefined;
  /** Index of the focused event among its lane's turn anchors, or -1. */
  turnIndex: number;
  /** Total turns in the focused event's lane. */
  totalTurns: number;
  onPrev: () => void;
  onNext: () => void;
  /** Jump to an arbitrary 1-based turn number within the lane (clamped). */
  goToTurn: (turnNumber: number) => void;
  /** Name of the focused event's agent lane ("main" or a subagent name). */
  laneName: string;
  /** Number of agent lanes (main + subagents); the `<` `>` control hides below 2. */
  laneCount: number;
  /** `h` key / `<` button - open the previous agent lane's first turn. */
  onPrevAgent: () => void;
  /** `l` key / `>` button - open the next agent lane's first turn. */
  onNextAgent: () => void;
  hasPrevAgent: boolean;
  hasNextAgent: boolean;
  /** Selected view tab + setter, both URL-backed (single source of truth). */
  focusTab: FocusTabValue;
}

/**
 * Turn navigation for the standalone single-event page (open-in-new-tab). Both
 * the focused event and the selected tab live in the URL (the single source of
 * truth): j/k + prev/next set the `event` param, the tab pills set the `tab`
 * param - each app supplies one `setParam(key, value)` that writes its query
 * string. Turns are computed over the fully-expanded tree (null), matching the
 * slice basis so the focused event always resolves and every turn is navigable.
 * Shared by the inspect and scout single-event pages (both embedded by hawk).
 */
export function useFocusTurnNavigation(
  eventNodes: EventNode[],
  eventId: string | null,
  tab: string,
  setParam: (key: string, value: string) => void
): FocusTurnNavigation {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listHandle = useRef<VirtualListHandle | null>(null);

  const flat = useMemo(() => flatTree(eventNodes, null), [eventNodes]);

  // Agent lanes (main + nested subagents). Turn numbering and j/k are scoped to
  // the focused event's lane so the focus page matches the swimlane-scoped main
  // view (e.g. "turn 1/6" within the researcher, not "1/18" across everything);
  // h/l + the < > buttons jump between lanes.
  const lanes = useMemo(() => computeAgentLanes(flat), [flat]);

  // A focus URL normally targets a model turn anchor, but a hand-built / deep
  // link can target a tool or sandbox event inside a turn. Resolve such an event
  // to its enclosing turn's model anchor (the nearest turn anchor at or before
  // it in document order) so the turn header + lane nav still resolve and the
  // slice shows the whole turn, matching the pre-lane behavior.
  const resolvedEventId = useMemo(() => {
    // No event param (a parameterless focus URL, or prev/next onto a sibling
    // sample) defaults to the first turn anchor, so the page loads the first
    // turn instead of rendering nothing.
    if (!eventId) return lanes[0]?.turnAnchorIds[0] ?? null;
    const anchors = new Set(lanes.flatMap((l) => l.turnAnchorIds));
    if (anchors.has(eventId)) return eventId;
    const idx = flat.findIndex((n) => n.id === eventId);
    for (let i = idx; i >= 0; i--) {
      const id = flat[i]?.id;
      if (id && anchors.has(id)) return id;
    }
    return eventId;
  }, [eventId, lanes, flat]);

  const slice = useMemo(
    () =>
      resolvedEventId ? focusedTurnNodes(eventNodes, resolvedEventId) : [],
    [eventNodes, resolvedEventId]
  );
  const laneIndex = useMemo(() => {
    if (!resolvedEventId) return -1;
    return lanes.findIndex((l) => l.turnAnchorIds.includes(resolvedEventId));
  }, [lanes, resolvedEventId]);
  const lane = laneIndex >= 0 ? lanes[laneIndex] : undefined;
  const anchorIds = useMemo(() => lane?.turnAnchorIds ?? [], [lane]);
  const turnIndex = resolvedEventId ? anchorIds.indexOf(resolvedEventId) : -1;
  const turnInfo: TurnInfo | undefined =
    turnIndex >= 0
      ? { turnNumber: turnIndex + 1, totalTurns: anchorIds.length }
      : undefined;

  const stepTurn = useCallback(
    (delta: 1 | -1) => {
      const next = anchorIds[turnIndex + delta];
      if (turnIndex === -1 || next === undefined) return;
      setParam("event", next);
    },
    [turnIndex, anchorIds, setParam]
  );
  const onPrev = useCallback(() => stepTurn(-1), [stepTurn]);
  const onNext = useCallback(() => stepTurn(1), [stepTurn]);

  const goToTurn = useCallback(
    (turnNumber: number) => {
      if (anchorIds.length === 0) return;
      const clamped = Math.max(
        0,
        Math.min(anchorIds.length - 1, turnNumber - 1)
      );
      setParam("event", anchorIds[clamped]!);
    },
    [anchorIds, setParam]
  );

  const stepAgent = useCallback(
    (delta: 1 | -1) => {
      if (laneIndex === -1) return;
      const nextLane = lanes[laneIndex + delta];
      const target = nextLane?.turnAnchorIds[0];
      if (target) setParam("event", target);
    },
    [laneIndex, lanes, setParam]
  );
  const onPrevAgent = useCallback(() => stepAgent(-1), [stepAgent]);
  const onNextAgent = useCallback(() => stepAgent(1), [stepAgent]);

  const onFirst = useCallback(() => goToTurn(1), [goToTurn]);
  const onLast = useCallback(
    () => goToTurn(anchorIds.length),
    [goToTurn, anchorIds.length]
  );

  useListKeyboardNavigation({
    listHandle,
    scrollRef,
    itemCount: slice.length,
    onPrev,
    onNext,
    onPrevAgent: lanes.length > 1 ? onPrevAgent : undefined,
    onNextAgent: lanes.length > 1 ? onNextAgent : undefined,
    onFirst: anchorIds.length > 0 ? onFirst : undefined,
    onLast: anchorIds.length > 0 ? onLast : undefined,
  });

  const focusTab = useMemo<FocusTabValue>(
    () => ({ tab, setTab: (next: string) => setParam("tab", next) }),
    [tab, setParam]
  );

  return {
    scrollRef,
    listHandle,
    slice,
    turnInfo,
    turnIndex,
    totalTurns: anchorIds.length,
    onPrev,
    onNext,
    goToTurn,
    laneName: lane?.name ?? "main",
    laneCount: lanes.length,
    onPrevAgent,
    onNextAgent,
    hasPrevAgent: laneIndex > 0,
    hasNextAgent: laneIndex >= 0 && laneIndex < lanes.length - 1,
    focusTab,
  };
}
