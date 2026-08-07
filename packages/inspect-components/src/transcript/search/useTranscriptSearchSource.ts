import { RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import type { Event } from "@tsmono/inspect-common/types";
import {
  useExtendedFind,
  useFindTargetSetter,
  type ExtendedFindFn,
  type FindDirection,
} from "@tsmono/react/components";

import type { SwimlaneRow } from "../timeline/swimlaneRows";
import type { TranscriptViewNodesHandle } from "../TranscriptViewNodes";

import {
  buildEventToRowMap,
  findAllMatches,
  findVariantPositions,
  SampleMatch,
  searchVariants,
} from "./sampleSearch";

const DEFAULT_ID = "transcript-sample";
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
 * Registers a sample-wide search source with ExtendedFindContext.
 *
 * - count(term): findAllMatches over the full sample. Cached per term.
 * - searchFn(term, dir): finds the next match across the entire sample,
 *   switches swimlane row if needed, sets the find target (auto-expand),
 *   then delegates to viewNodesRef.scrollToEvent.
 *
 * Preconditions: must be mounted inside an `ExtendedFindProvider`. The
 * `FindTargetProvider` is optional — its setter no-ops when absent.
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
  const { registerVirtualList, registerMatchCounter, registerMatchLocator } =
    useExtendedFind();
  const setFindTarget = useFindTargetSetter();

  const eventToRow = useMemo(() => buildEventToRowMap(rows), [rows]);

  // Position of each event in the sample's global order. `findAllMatches`
  // walks `events` in this order, so it doubles as the ordering of `matches`
  // and lets the viewport anchor compare positions across rows — the view's
  // flattened nodes only cover the selected row.
  const eventOrder = useMemo(() => {
    const map = new Map<string, number>();
    events.forEach((event, index) => {
      if (event.uuid) map.set(event.uuid, index);
    });
    return map;
  }, [events]);

  const cacheRef = useRef<{
    events: Event[];
    eventToRow: Map<string, string>;
    term: string;
    matches: SampleMatch[];
  } | null>(null);
  const getMatches = useCallback(
    (term: string): SampleMatch[] => {
      const c = cacheRef.current;
      if (
        c &&
        c.events === events &&
        c.eventToRow === eventToRow &&
        c.term === term
      ) {
        return c.matches;
      }
      const matches = findAllMatches(events, term, eventToRow);
      cacheRef.current = { events, eventToRow, term, matches };
      return matches;
    },
    [events, eventToRow]
  );

  // Read across `await` boundaries to detect "user is already on this row"
  // mid-search; needs to be a ref so a row-switch in flight sees the update.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const lastResolvedRef = useRef<{ match: SampleMatch; term: string } | null>(
    null
  );
  const invocationIdRef = useRef(0);
  // Self-correction timers scheduled at the end of searchFn. Tracked so
  // unmount can clear them — otherwise they fire against detached DOM.
  const pendingTimersRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const timers = pendingTimersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Active search term. Set by countFn on every keystroke so the listener
  // below has it on the first selectionchange after a fresh search.
  const activeTermRef = useRef<string>("");
  // Keep `lastResolvedRef` in sync when window.find advances within a row
  // without going through our searchFn. Otherwise the next cross-row
  // navigation would pickNext from a stale position.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onSelectionChange = () => {
      const term = activeTermRef.current;
      if (!term) return;
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      // Cheap pre-filter: a real find result is a single text node selection
      // exactly the length of the term. Skip the expensive `range.toString()`
      // serialization for everything else (Ctrl-A on a long transcript can
      // make every keystroke in the find box block on MB-sized text).
      if (range.startContainer !== range.endContainer) return;
      if (range.endOffset - range.startOffset !== term.length) return;
      if (range.toString().toLowerCase() !== term.toLowerCase()) return;
      const matches = getMatches(term);
      const match = matchAtSelection(matches, term);
      if (match) {
        lastResolvedRef.current = { match, term };
      } else if (!selectionInEvent(lastResolvedRef.current?.match.eventId)) {
        // The selection has genuinely left the remembered event — forget the
        // position rather than let the next cross-row jump resume from it (a
        // stale ref is what made Next teleport back to the top of the
        // transcript). But `matchAtSelection` can also come up empty while
        // the selection is still sitting on the remembered event: some
        // panels render more DOM occurrences of the term than
        // `extractEventFields` counted as matches (e.g. an assistant `input`
        // message the panel shows but the field extractor skips), so the
        // occurrence-index walk can overshoot. That's not the user moving
        // away, so `selectionInEvent` above keeps the ref intact for it. A
        // cleared selection (rangeCount 0, e.g. findExtendedInDOM's
        // deliberate removeAllRanges before calling us) early-returns above
        // and leaves the ref intact either way.
        lastResolvedRef.current = null;
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [getMatches]);

  const countFn = useCallback(
    (term: string): number => {
      // FindBand calls this on every keystroke before any navigation, so it's
      // the natural place to record the active term for the selection
      // listener — earlier than searchFn, which only fires on cross-row jumps.
      activeTermRef.current = term;
      return getMatches(term).length;
    },
    [getMatches]
  );

  // Answers "which match is the user's selection on?" for FindBand's counter.
  // Unlike searchFn this runs while the selection is live — FindBand calls it
  // after window.find has landed, whereas findExtendedInDOM clears the
  // selection before it ever reaches searchFn.
  const locatorFn = useCallback(
    (term: string): number | null => {
      if (!term) return null;
      const matches = getMatches(term);
      const match = matchAtSelection(matches, term);
      return match ? matches.indexOf(match) : null;
    },
    [getMatches]
  );

  const searchFn: ExtendedFindFn = useCallback(
    async (term, direction, onContentReady) => {
      const myId = ++invocationIdRef.current;
      const isStale = () => myId !== invocationIdRef.current;

      const matches = getMatches(term);
      if (matches.length === 0) return false;
      activeTermRef.current = term;

      // Match the headroom UI to the user's search direction (forward press
      // collapses the swimlane like manual scroll-down; backward expands it),
      // and lock the scroll-direction tracker so its observations of the
      // imminent imperative scroll don't fight us.
      onHeadroomResetAnchor?.(true);
      onHeadroomSetHidden?.(direction === "forward");

      let position = resolvePosition({
        matches,
        term,
        direction,
        last: lastResolvedRef.current,
        view: viewNodesRef.current,
        eventOrder,
      });

      // Iterate forward/backward until we find a match whose panel actually
      // mounts. Some events (deeply nested under collapsed subtask spans, or
      // filtered out of the rendered tree entirely) can be counted by
      // buildEventToRowMap but never reach the DOM — without this skip, the
      // user gets stuck at the boundary with no way forward. Cap attempts so
      // a totally unreachable cluster doesn't spin for 30s+.
      const SKIP_LIMIT = Math.min(matches.length, 8);
      let next: SampleMatch | null = null;
      for (let attempt = 0; attempt < SKIP_LIMIT; attempt++) {
        next = pickNext(matches, position, direction);

        if (next.rowKey !== selectedRef.current) {
          onSelect(next.rowKey);
          const ready = await waitForRow(viewNodesRef, next.eventId);
          if (isStale()) return false;
          if (!ready) {
            position = matches.indexOf(next);
            lastResolvedRef.current = { match: next, term };
            continue;
          }
        }

        setFindTarget({ term, eventId: next.eventId });
        await raf();
        if (isStale()) return false;
        await raf();
        if (isStale()) return false;

        viewNodesRef.current?.scrollToEvent(next.eventId);
        const inDom = await waitForEventInDOM(next.eventId);
        if (isStale()) return false;
        if (inDom) break;

        // Unreachable event — advance past ALL matches sharing this eventId.
        // A single nested-but-unrendered event typically has many occurrences;
        // trying each would burn SKIP_LIMIT on identical failures.
        const skippedEventId = next.eventId;
        let lastSkipIdx = matches.indexOf(next);
        const stride = direction === "forward" ? 1 : -1;
        for (
          let idx = lastSkipIdx + stride;
          idx >= 0 &&
          idx < matches.length &&
          matches[idx]!.eventId === skippedEventId;
          idx += stride
        ) {
          lastSkipIdx = idx;
        }
        position = lastSkipIdx;
        lastResolvedRef.current = { match: matches[lastSkipIdx]!, term };
        next = null;
      }
      if (!next) return false;

      // Position the cursor so FindBand's subsequent `window.find` lands on
      // the term inside OUR chosen panel. window.find advances FROM the
      // current selection (it does NOT match at the cursor itself), so
      // collapse JUST BEFORE the term going forward and JUST AFTER going
      // backward. Bails silently if the term isn't rendered in the panel
      // (e.g. a JSON-stringified field) — window.find then picks whatever.
      positionSelectionAroundTerm(next.eventId, term, direction);

      lastResolvedRef.current = { match: next, term };
      onContentReady();

      // The transcript renders many code blocks that get syntax-highlighted
      // asynchronously (Prism splitting `<code>` text into many spans), and
      // many ExpandablePanels that re-render on `setFindTarget`. Either
      // can detach the text node `window.find` just anchored on, silently
      // collapsing the highlight ~hundreds of ms after the search lands.
      // Re-establish the selection after settling, but only if the current
      // highlight is missing or wrong (no-op when it survives naturally).
      const reselectId = next.eventId;
      const timer = window.setTimeout(() => {
        if (isStale()) return;
        reselectTermInPanel(reselectId, term);
      }, 300);
      pendingTimersRef.current.add(timer);
      return true;
    },
    [
      getMatches,
      eventOrder,
      viewNodesRef,
      onSelect,
      setFindTarget,
      onHeadroomResetAnchor,
      onHeadroomSetHidden,
    ]
  );

  useEffect(() => {
    const unCount = registerMatchCounter(id, countFn);
    const unSearch = registerVirtualList(id, searchFn);
    const unLocate = registerMatchLocator(id, locatorFn);
    return () => {
      unCount();
      unSearch();
      unLocate();
    };
  }, [
    id,
    registerMatchCounter,
    registerVirtualList,
    registerMatchLocator,
    countFn,
    searchFn,
    locatorFn,
  ]);
}

function pickNext(
  matches: SampleMatch[],
  position: number,
  dir: FindDirection
): SampleMatch {
  const len = matches.length;
  // `position` is the index of the "current" match (or -1 if none).
  if (position < 0) {
    return dir === "forward" ? matches[0]! : matches[len - 1]!;
  }
  return dir === "forward"
    ? matches[(position + 1) % len]!
    : matches[(position - 1 + len) % len]!;
}

interface ResolvePositionOptions {
  matches: SampleMatch[];
  term: string;
  direction: FindDirection;
  last: { match: SampleMatch; term: string } | null;
  view: TranscriptViewNodesHandle | null;
  eventOrder: Map<string, number>;
}

/**
 * Index of the "current" match — the one `pickNext` advances from.
 *
 * Layered, most trustworthy first:
 *  1. the last match the selection listener resolved, when the term is
 *     unchanged. That listener sees every `window.find` hit, so this is the
 *     live selection's position; it is cleared when the selection leaves the
 *     remembered event (a selection on a different, unindexed occurrence
 *     within that same event does not clear it).
 *  2. the viewport, so a press moves on from what is on screen rather than
 *     jumping to the top of the transcript.
 *  3. -1, when no view is mounted, or when no visible node maps to a known
 *     event (see `viewportPosition`) — `pickNext` then falls back to
 *     `matches[0]` (forward) or the last match (backward), matching the
 *     direction, which is right for a fresh search with nothing resolved.
 */
function resolvePosition(opts: ResolvePositionOptions): number {
  const { matches, term, direction, last, view, eventOrder } = opts;

  if (last && last.term === term) {
    const idx = matches.findIndex(
      (m) =>
        m.eventId === last.match.eventId &&
        m.fieldKey === last.match.fieldKey &&
        m.fieldIndex === last.match.fieldIndex &&
        m.occurrenceIndex === last.match.occurrenceIndex
    );
    if (idx !== -1) return idx;
  }

  return viewportPosition(matches, direction, view, eventOrder);
}

/**
 * Anchor to what is on screen: map the visible nodes into the global event
 * order, then return the index just outside the viewport in the direction of
 * travel, so `pickNext` lands on the first match at or beyond the current view.
 *
 * Returns -1 when nothing is mounted or no visible node is a known event, which
 * `pickNext` reads as "no current position".
 */
function viewportPosition(
  matches: SampleMatch[],
  direction: FindDirection,
  view: TranscriptViewNodesHandle | null,
  eventOrder: Map<string, number>
): number {
  const range = view?.getVisibleRange();
  const flattened = view?.getFlattenedNodes() ?? [];
  if (!range || flattened.length === 0) return -1;

  let minVisible = Infinity;
  let maxVisible = -Infinity;
  for (const node of flattened.slice(range.startIndex, range.endIndex + 1)) {
    const order = eventOrder.get(node.id);
    // Synthetic node ids (events without a uuid) aren't in the map.
    if (order === undefined) continue;
    if (order < minVisible) minVisible = order;
    if (order > maxVisible) maxVisible = order;
  }
  if (minVisible === Infinity) return -1;

  // `matches` is in global event order, so the boundary is a linear scan.
  if (direction === "forward") {
    const first = matches.findIndex(
      (m) => (eventOrder.get(m.eventId) ?? -1) >= minVisible
    );
    // Every match sits above the viewport — resume at the end so pickNext
    // wraps to the top, the only sensible forward move.
    if (first === -1) return matches.length - 1;
    return first - 1;
  }

  let lastIdx = -1;
  for (let i = 0; i < matches.length; i++) {
    if ((eventOrder.get(matches[i]!.eventId) ?? Infinity) <= maxVisible) {
      lastIdx = i;
    }
  }
  // Every match sits below the viewport — resume at the start so pickNext
  // wraps to the end.
  if (lastIdx === -1) return 0;
  return lastIdx + 1;
}

/**
 * Walk up from `node` to the nearest ancestor element whose `id` satisfies
 * `isMatch`, treating `node` itself as the starting point if it's already an
 * element. Returns `null` if no such ancestor exists.
 */
function closestEventAncestor(
  node: Node,
  isMatch: (id: string) => boolean
): Element | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  while (el && !isMatch(el.id)) el = el.parentElement;
  return el;
}

/**
 * True if the current document selection sits inside the event panel with id
 * `eventId`. Used by the selectionchange listener to distinguish "the user
 * is still on the remembered match, but our occurrence index came up short"
 * from "the user has moved somewhere else" — only the latter should forget
 * `lastResolvedRef`. Returns `false` when `eventId` is `undefined` (nothing
 * remembered, so nothing to protect) or when there is no live selection.
 */
function selectionInEvent(eventId: string | undefined): boolean {
  if (!eventId || typeof window === "undefined") return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  return (
    closestEventAncestor(range.startContainer, (id) => id === eventId) !== null
  );
}

/**
 * Find the SampleMatch corresponding to the current document selection, if any.
 *
 * Walks up from the selection's startContainer to find an event-panel element
 * (one whose `id` is in `matches`'s eventId set). Then counts how many
 * occurrences of `term` precede the selection within that event's text — that
 * count is the DOM-order occurrence index, which we map to the n-th match in
 * our array for that event.
 *
 * Returns `null` if there is no selection, no event ancestor, or the count
 * runs past the matches we know about (e.g. selection isn't actually on a
 * `term` instance).
 */
function matchAtSelection(
  matches: SampleMatch[],
  term: string
): SampleMatch | null {
  if (typeof window === "undefined" || !term) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);

  const eventIds = new Set(matches.map((m) => m.eventId));
  const el = closestEventAncestor(range.startContainer, (id) =>
    eventIds.has(id)
  );
  if (!el) return null;
  const eventId = el.id;

  // Count under the same variants `findAllMatches` enumerated, or the
  // occurrence index computed here would address a different match than the
  // one the user selected. A quoted term is the case that breaks: the match
  // list counts every bare `role`, so counting only literal `"role"` in the
  // DOM maps the selection onto some earlier match entirely.
  const variants = searchVariants(term);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let occurrenceInEvent = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const atSelection = textNode === range.startContainer;
    const text = (
      atSelection ? textNode.data.slice(0, range.startOffset) : textNode.data
    ).toLowerCase();
    occurrenceInEvent += findVariantPositions(text, variants).length;
    if (atSelection) break;
  }

  let seen = 0;
  for (const m of matches) {
    if (m.eventId !== eventId) continue;
    if (seen === occurrenceInEvent) return m;
    seen++;
  }
  return null;
}

/**
 * Walk the DOM under the event element with `eventId` and place a collapsed
 * selection adjacent to the FIRST occurrence of `term` (forward) or the LAST
 * occurrence (backward), so FindBand's subsequent `window.find` advances onto
 * exactly that occurrence.
 *
 * Forward: cursor BEFORE the first match — `window.find` searches forward
 * from the cursor and lands on the term.
 * Backward: cursor AFTER the last match — `window.find` with backward=true
 * searches backward from the cursor and lands on the term. (If we collapsed
 * before instead, backward would skip past it and either find nothing or
 * land in unrelated DOM, which makes findExtendedInDOM return false and the
 * counter fail to update.)
 *
 * If the panel isn't mounted or doesn't render the term as text (e.g. the
 * match was in a JSON-stringified field we don't render), bail silently —
 * FindBand will fall back to its default windowFind behavior.
 */
function positionSelectionAroundTerm(
  eventId: string,
  term: string,
  direction: FindDirection
): boolean {
  const root = document.getElementById(eventId);
  if (!root) return false;
  const lowered = term.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let target: { node: Text; idx: number } | null = null;
  for (let node; (node = walker.nextNode());) {
    const textNode = node as Text;
    const text = textNode.data.toLowerCase();
    let from = 0;
    while ((from = text.indexOf(lowered, from)) !== -1) {
      target = { node: textNode, idx: from };
      from += lowered.length;
      if (direction === "forward") break;
    }
    if (target && direction === "forward") break;
  }
  if (!target) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  const range = document.createRange();
  range.setStart(
    target.node,
    direction === "forward" ? target.idx : target.idx + term.length
  );
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/**
 * If the current selection no longer covers `term` inside the panel
 * (because a late settling pass — Virtuoso re-render, lazy syntax
 * highlighting, ExpandablePanel auto-expand reflow — detached the text
 * node `window.find` was anchored on), re-anchor the selection to the
 * first occurrence of `term` in the panel. Returns false (no-op) when
 * the existing highlight is intact.
 */
function reselectTermInPanel(eventId: string, term: string): boolean {
  const root = document.getElementById(eventId);
  if (!root) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  if (
    sel.rangeCount > 0 &&
    !sel.getRangeAt(0).collapsed &&
    sel.getRangeAt(0).toString().toLowerCase() === term.toLowerCase() &&
    root.contains(sel.getRangeAt(0).startContainer)
  ) {
    return true; // existing highlight is intact — don't disturb
  }
  const lowered = term.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const idx = (node.textContent ?? "").toLowerCase().indexOf(lowered);
    if (idx === -1) continue;
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + term.length);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  return false;
}

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
  eventId: string
): Promise<boolean> {
  for (let i = 0; i < SETTLE_LIMIT; i++) {
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
 * `scrollToEvent` triggers a Virtuoso scroll for an off-screen target, the
 * panel takes several frames to mount. Returns false on timeout. The budget
 * is shorter than for row mount because we use this to detect unreachable
 * matches and skip them — too long a wait makes skipping feel laggy.
 */
async function waitForEventInDOM(eventId: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const DOM_BUDGET = 30;
  for (let i = 0; i < DOM_BUDGET; i++) {
    if (document.getElementById(eventId)) return true;
    await raf();
  }
  return false;
}
