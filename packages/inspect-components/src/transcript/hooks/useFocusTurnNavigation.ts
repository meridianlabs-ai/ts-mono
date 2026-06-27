import { useCallback, useMemo, useRef, type RefObject } from "react";

import { useListKeyboardNavigation } from "@tsmono/react/hooks";
import type { VirtualListHandle } from "@tsmono/react/virtual";

import type { FocusTabValue } from "../FocusTabContext";
import type { TurnInfo } from "../outline/tree-visitors";
import { flatTree } from "../transform/flatten";
import { computeTranscriptTurns, focusedTurnNodes } from "../turnNavigation";
import type { EventNode } from "../types";

export interface FocusTurnNavigation {
  scrollRef: RefObject<HTMLDivElement | null>;
  listHandle: RefObject<VirtualListHandle | null>;
  /** The focused turn's events (model + its tools), fully expanded. */
  slice: EventNode[];
  /** Turn number/total for the focused event, if it resolves to a turn. */
  turnInfo: TurnInfo | undefined;
  /** Index of the focused event among the turn anchors, or -1. */
  turnIndex: number;
  /** Total navigable turns. */
  totalTurns: number;
  onPrev: () => void;
  onNext: () => void;
  /** Selected view tab + setter, both URL-backed (single source of truth). */
  focusTab: FocusTabValue;
}

/**
 * Turn navigation for the standalone single-event page (open-in-new-tab). Both
 * the focused event and the selected tab live in the URL (the single source of
 * truth): j/k + prev/next set the `event` param, the tab pills set the `tab`
 * param — each app supplies one `setParam(key, value)` that writes its query
 * string. Turns are computed over the fully-expanded tree (null), matching the
 * slice basis so the focused event always resolves and every turn is navigable.
 * Shared by the inspect and scout single-event pages.
 */
export function useFocusTurnNavigation(
  eventNodes: EventNode[],
  eventId: string | null,
  tab: string,
  setParam: (key: string, value: string) => void
): FocusTurnNavigation {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listHandle = useRef<VirtualListHandle | null>(null);

  const slice = useMemo(
    () => (eventId ? focusedTurnNodes(eventNodes, eventId) : []),
    [eventNodes, eventId]
  );

  const { turnMap, anchorIds } = useMemo(
    () => computeTranscriptTurns(eventNodes, flatTree(eventNodes, null), null),
    [eventNodes]
  );
  const turnInfo = eventId ? turnMap.get(eventId) : undefined;
  const turnIndex = eventId ? anchorIds.indexOf(eventId) : -1;

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

  useListKeyboardNavigation({
    listHandle,
    scrollRef,
    itemCount: slice.length,
    onPrev,
    onNext,
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
    focusTab,
  };
}
