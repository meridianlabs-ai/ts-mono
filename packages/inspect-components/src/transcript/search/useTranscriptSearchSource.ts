import { RefObject, useEffect, useMemo } from "react";

import type { Event } from "@tsmono/inspect-common/types";
import {
  cacheLastCall,
  useExtendedFind,
  type FindSource,
} from "@tsmono/react/components";
import { useLatestRef } from "@tsmono/react/hooks";

import type { SwimlaneRow } from "../timeline/swimlaneRows";
import type { TranscriptViewNodesHandle } from "../TranscriptViewNodes";

import { buildEventToRowMap, findAllMatches } from "./sampleSearch";

const DEFAULT_ID = "transcript-sample";
const sameEvent = (eventId: string) => eventId;
const SETTLE_LIMIT = 90;

export interface UseTranscriptSearchSourceOptions {
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
  /** Stable registration ID. Default `"transcript-sample"`. */
  id?: string;
}

/**
 * Registers the sample's events as a find source. Its items are the events
 * in sample order, across every swimlane row: counts come from the event
 * data, and revealing an event switches to its row and scrolls to it.
 *
 * Preconditions: must be mounted inside an `ExtendedFindProvider`.
 */
export function useTranscriptSearchSource(
  options: UseTranscriptSearchSourceOptions
): void {
  const {
    events,
    rows,
    selected,
    onSelect,
    viewNodesRef,
    onHeadroomResetAnchor,
    onHeadroomSetHidden,
    id = DEFAULT_ID,
  } = options;
  const { registerFindSource } = useExtendedFind();
  // Read at reveal time, so the source doesn't re-register on every render.
  const latest = useLatestRef({
    selected,
    onSelect,
    onHeadroomResetAnchor,
    onHeadroomSetHidden,
  });

  // Identity matters: registering a new source makes the find band re-collect
  // its matches, so it changes only when the searchable events do.
  const source = useMemo<FindSource>(() => {
    const eventToRow = buildEventToRowMap(rows);
    const eventIndex = new Map<string, number>();
    events.forEach((event, index) => {
      if (event.uuid) eventIndex.set(event.uuid, index);
    });
    const root = () => viewNodesRef.current?.getElement() ?? null;
    // Keyed on the view's redirects too: they arrive when the row mounts and
    // change when the selected row does.
    const countByItem = cacheLastCall(
      (term: string, rowEventId: (eventId: string) => string) => {
        const counts = new Map<number, number>();
        // An approval or sentinel shows inside its tool's row, so its
        // matches count under the item that renders them.
        for (const match of findAllMatches(events, term, eventToRow)) {
          const index =
            eventIndex.get(rowEventId(match.eventId)) ??
            eventIndex.get(match.eventId)!;
          counts.set(index, (counts.get(index) ?? 0) + 1);
        }
        return [...counts]
          .map(([item, count]) => ({ item, count }))
          .sort((a, b) => a.item - b.item);
      }
    );

    return {
      anchor: root,
      countByItem: (term) =>
        countByItem(term, viewNodesRef.current?.rowEventId ?? sameEvent),
      itemOf: (node) => {
        const container = root();
        if (!container?.contains(node)) return null;
        let el = node instanceof Element ? node : node.parentElement;
        for (; el && el !== container; el = el.parentElement) {
          const index = el.id ? eventIndex.get(el.id) : undefined;
          if (index !== undefined) return index;
        }
        return null;
      },
      renderedItems: () => {
        const rendered = new Set<number>();
        for (const el of root()?.querySelectorAll("[id]") ?? []) {
          const index = eventIndex.get(el.id);
          if (index !== undefined) rendered.add(index);
        }
        return rendered;
      },
      reveal: async (item, direction, signal) => {
        const eventId = events[item]?.uuid;
        const rowKey = eventId ? eventToRow.get(eventId) : undefined;
        if (!eventId || rowKey === undefined) return false;
        const {
          selected,
          onSelect,
          onHeadroomResetAnchor,
          onHeadroomSetHidden,
        } = latest.current;
        onHeadroomResetAnchor?.(true);
        onHeadroomSetHidden?.(direction === "forward");
        if (rowKey !== selected) {
          onSelect(rowKey);
          if (!(await waitForRow(viewNodesRef, eventId))) return false;
        }
        const view = viewNodesRef.current;
        if (signal.aborted || !view) return false;
        // Resolve once the list's own scroll lands, so the band's scroll to
        // the match comes after it rather than being overwritten.
        await new Promise<void>((resolve, reject) => {
          const cancelScroll = view.scrollToEvent(eventId, {
            onDone: resolve,
            onAbandon: () => reject(new Error("Another scroll took over")),
          });
          signal.addEventListener("abort", cancelScroll, { once: true });
        });
        // An approval or sentinel has no element of its own: wait for the
        // row that renders it.
        return waitForEventInDOM(
          viewNodesRef.current?.rowEventId(eventId) ?? eventId
        );
      },
    };
  }, [events, rows, viewNodesRef, latest]);

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(
    () => registerFindSource(id, source),
    [id, registerFindSource, source]
  );
}

function raf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Wait for the freshly-selected row to mount: poll until the target eventId
 * is present in the flattened-node list, or the budget expires.
 * Returns false if the view is not mounted or the event never appears.
 */
async function waitForRow(
  viewNodesRef: RefObject<TranscriptViewNodesHandle | null>,
  eventId: string
): Promise<boolean> {
  for (let i = 0; i < SETTLE_LIMIT; i++) {
    const view = viewNodesRef.current;
    if (!view) return false;
    if (view.getFlattenedNodes().some((n) => n.id === eventId)) return true;
    await raf();
  }
  return false;
}

/**
 * Wait until the event panel is actually rendered to the DOM. After
 * `scrollToEvent` triggers a virtual-list scroll for an off-screen target, the
 * panel takes several frames to mount. Returns false on timeout.
 */
async function waitForEventInDOM(eventId: string): Promise<boolean> {
  const DOM_BUDGET = 30;
  for (let i = 0; i < DOM_BUDGET; i++) {
    if (document.getElementById(eventId)) return true;
    await raf();
  }
  return false;
}
