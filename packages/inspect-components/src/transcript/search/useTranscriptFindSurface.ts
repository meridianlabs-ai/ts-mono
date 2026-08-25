import { RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import type { Event } from "@tsmono/inspect-common/types";
import { useFindTargetSetter } from "@tsmono/react/components";
import {
  useFindStateGetter,
  useFindSurface,
  type FindMatch,
  type FindSurface,
  type RevealOutcome,
} from "@tsmono/react/find";

import { createTranscriptFindSource, TRANSCRIPT_FIND_SCOPE } from "../../find";
import type { SwimlaneRow } from "../timeline/swimlaneRows";
import type { TranscriptViewNodesHandle } from "../TranscriptViewNodes";

import { buildEventToRowMap } from "./sampleSearch";

const SETTLE_LIMIT = 90;
const DOM_BUDGET = 30;

export interface UseTranscriptFindSurfaceOptions {
  events: Event[];
  rows: SwimlaneRow[];
  selected: string | null;
  onSelect: (rowKey: string | null) => void;
  viewNodesRef: RefObject<TranscriptViewNodesHandle | null>;
  /** Suppress headroom-driven swimlane collapse during programmatic scrolls.
   *  Without this, scrolling between matches makes the swimlane bar flicker
   *  collapsed→expanded as the headroom hook misreads our scroll as a user
   *  gesture. Pass `true` to enable the debounced lock; the hook releases it
   *  automatically once the scroll settles. */
  onHeadroomResetAnchor?: (debounce?: boolean) => void;
  /** Force the headroom hidden state to match the search direction so a
   *  Next press collapses the swimlane (like a manual scroll-down) and a
   *  Prev press reveals it (like a scroll-up). Without this, the headroom
   *  hook only reflects whatever residual scroll motion useScrollDirection
   *  detected, which doesn't reliably correspond to the user's intent. */
  onHeadroomSetHidden?: (hidden: boolean) => void;
}

/**
 * Registers the transcript FindSurface with the find coordinator:
 *
 * - source: the default in-memory transcript source over `events` (the
 *   caller passes searchableEvents — hidden types already removed) with
 *   anchors limited to what the row map can reveal.
 * - reveal(match): switch swimlane row if needed, wait for the row to
 *   mount, set the find target (auto-expand), then scrollToEvent. Returns
 *   "revealed" iff the event element reaches the DOM within the frame
 *   budget.
 *
 * No-op when mounted outside a FindProvider. The FindTargetProvider is
 * optional — its setter no-ops when absent.
 */
export function useTranscriptFindSurface(
  options: UseTranscriptFindSurfaceOptions
): void {
  const {
    events,
    rows,
    selected,
    onSelect,
    viewNodesRef,
    onHeadroomResetAnchor,
    onHeadroomSetHidden,
  } = options;
  const getFindState = useFindStateGetter();
  const setFindTarget = useFindTargetSetter();

  const eventToRow = useMemo(() => buildEventToRowMap(rows), [rows]);
  const source = useMemo(
    () => createTranscriptFindSource(events, eventToRow),
    [events, eventToRow]
  );

  // Read across `await` boundaries to detect "user is already on this row"
  // mid-reveal; a ref so a row-switch in flight sees the update.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const reveal = useCallback(
    async (match: FindMatch, signal: AbortSignal): Promise<RevealOutcome> => {
      const eventId = match.anchor.id;
      const rowKey = eventToRow.get(eventId);
      if (rowKey === undefined) return "missing";
      const { term, lastDirection } = getFindState();

      // Match the headroom UI to the user's step direction (forward press
      // collapses the swimlane like manual scroll-down; backward expands
      // it), and lock the scroll-direction tracker so its observations of
      // the imminent imperative scroll don't fight us.
      onHeadroomResetAnchor?.(true);
      onHeadroomSetHidden?.(lastDirection === "forward");

      if (rowKey !== selectedRef.current) {
        onSelect(rowKey);
        const ready = await waitForRow(viewNodesRef, eventId, signal);
        if (signal.aborted || !ready) return "missing";
      }

      // Publish the per-event target BEFORE scrolling so ExpandablePanels
      // containing the term auto-expand; two frames let that re-render land
      // so scrollToEvent measures the expanded layout.
      setFindTarget({ term, eventId });
      await raf();
      if (isAborted(signal)) return "missing";
      await raf();
      if (isAborted(signal)) return "missing";

      viewNodesRef.current?.scrollToEvent(eventId);
      const inDom = await waitForEventInDOM(eventId, signal);
      return inDom && !isAborted(signal) ? "revealed" : "missing";
    },
    [
      eventToRow,
      getFindState,
      onHeadroomResetAnchor,
      onHeadroomSetHidden,
      onSelect,
      setFindTarget,
      viewNodesRef,
    ]
  );

  const surface = useMemo<FindSurface>(
    () => ({ scopeId: TRANSCRIPT_FIND_SCOPE, source, reveal }),
    [source, reveal]
  );
  useFindSurface(surface);
}

// Through a call so control-flow narrowing doesn't pin `signal.aborted`
// to the value it had before the intervening awaits.
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

function raf(): Promise<void> {
  return new Promise((resolve) =>
    typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(() => resolve())
      : setTimeout(resolve, 0)
  );
}

/**
 * Wait for the freshly-selected row to mount: poll until the target eventId
 * is present in the flattened-node list, or the budget expires.
 * Returns false if the view is not mounted or the event never appears.
 */
async function waitForRow(
  viewNodesRef: RefObject<TranscriptViewNodesHandle | null>,
  eventId: string,
  signal: AbortSignal
): Promise<boolean> {
  for (let i = 0; i < SETTLE_LIMIT; i++) {
    if (signal.aborted) return false;
    const view = viewNodesRef.current;
    if (!view) {
      // No mounted view to wait on — bail immediately.
      return false;
    }
    if (view.getFlattenedNodes().some((n) => n.id === eventId)) return true;
    await raf();
  }
  return false;
}

/**
 * Wait until the event panel is actually rendered to the DOM. After
 * `scrollToEvent` triggers a virtual-list scroll for an off-screen target,
 * the panel takes several frames to mount. Returns false on timeout — the
 * budget is short so an unrevealable anchor (which the projection should
 * have excluded) degrades to a flash rather than a long stall.
 */
async function waitForEventInDOM(
  eventId: string,
  signal: AbortSignal
): Promise<boolean> {
  if (typeof document === "undefined") return false;
  for (let i = 0; i < DOM_BUDGET; i++) {
    if (signal.aborted) return false;
    if (document.getElementById(eventId)) return true;
    await raf();
  }
  return false;
}
