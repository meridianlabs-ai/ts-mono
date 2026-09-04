// The find contract (design/pluggable-find.md). Types only.

export interface FindAnchor {
  /** Row anchor id (`messageRowAnchorIds` for the Messages tab). */
  id: string;
}

/** A row the source found matches in. The source says which rows and roughly
 *  how many; the rendered row says exactly where. */
export interface FindRow {
  anchor: FindAnchor;
  /** 0-based position of the row in the surface, so a surface can page its
   *  data through a row it has not loaded yet before revealing it. */
  index: number;
  /** The source's count of matches in the row (an estimate). */
  count: number;
  /** The exact source substrings that matched; the row highlights every DOM
   *  occurrence of these. */
  texts: string[];
}

export interface FindQuery {
  /** Matched as a case- and diacritic-insensitive literal substring. */
  text: string;
}

/** One page of a forward scan: the next matching rows after the cursor. */
export interface FindPage {
  rows: FindRow[];
  /** The page reached the last row of the source as it is now; with
   *  `complete`, the scan has seen every match there will be. */
  atEnd: boolean;
  /** False while the sample is still being written. */
  complete: boolean;
}

export interface FindSource {
  /** Matching rows strictly after `after` (from the top when undefined); the
   *  source decides how many a page holds. */
  find(
    query: FindQuery,
    after: FindAnchor | undefined,
    signal: AbortSignal
  ): Promise<FindPage>;
}

/** How a row shows the occurrence a reveal was requested for: "jumped" when
 *  the row was not mounted at activation (the list brought it in
 *  edge-aligned, so the occurrence is centred even when in view), "mounted"
 *  when it was (scrolled only when out of view). */
export type FindReveal = "jumped" | "mounted";

export interface FindSurface {
  scopeId: string;
  source: FindSource;
  /** Bring the row into view (page it in, jump the list). Fire-and-forget:
   *  the row itself centres the active occurrence once it renders, or
   *  flashes if it renders none. A function property, not a method, so the
   *  coordinator can hold it detached. */
  reveal: (row: FindRow, signal: AbortSignal) => void;
}

/** Coordinator state consumed by FindBand and the per-row highlight hook. */
export interface FindState {
  /** Current search term ("" when idle). */
  term: string;
  /** Every matching row the scan has found so far, in scope order. */
  rows: FindRow[];
  /** Index of the active row within `rows`, or null. */
  activeRow: number | null;
  /** 0-based DOM occurrence within the active row, or null. */
  activeOccurrence: number | null;
  /** 0-based position of the active occurrence among all matches (the "N"
   *  of "N of M"): the source counts of the rows before, plus the DOM index
   *  clamped to the active row's source count. Null while the active row
   *  renders no match. */
  activeOrdinal: number | null;
  /** Matches found so far (the "M"); null until the first page lands. Never
   *  rewritten from the DOM. */
  count: number | null;
  /** The scan walked off the end of a sealed sample: `count` is exact (else
   *  the band shows M+). */
  exact: boolean;
  /** The scan reached the source's end and found nothing. */
  noResults: boolean;
  /** Why the last page failed, until the next search or close. */
  error: string | null;
  /** Scope of the registered surface, or null. */
  scopeId: string | null;
}

export interface FindCoordinator {
  /** Current state snapshot (subscribe through `useFindState`). */
  getState(): FindState;
  registerSurface(surface: FindSurface): () => void;
  /** Swap the registered surface's source in place (its view configuration
   *  changed); re-scans like `invalidate`. */
  updateSource(scopeId: string, source: FindSource): void;
  /** The registered surface's data changed: re-scan the current term,
   *  relocating the active row. */
  invalidate(scopeId: string): void;
  /** A row's highlighter is mounted (returns the detach). Only a mounted
   *  row's DOM count is kept. */
  attachRow(anchorId: string): () => void;
  /** A mounted row reports how many DOM matches of its texts it renders;
   *  stepping inside the row then follows that count, not the source's.
   *  `null` withdraws the report (the row is re-rendering) so stepping falls
   *  back to the source count. */
  reportRowCount(anchorId: string, count: number | null): void;
  /** Take the reveal requested for the active row's occurrence: non-null
   *  exactly once per activation (a term's first hit, a step, a wrap, a
   *  relocation whose row vanished), for that row only. A relocation that
   *  keeps the row requests none, so the row highlights without scrolling. */
  claimReveal(anchorId: string): FindReveal | null;
  /** Start a new query (aborting any in-flight one). "" clears. */
  setTerm(term: string): void;
  /** Step to the next/previous occurrence, wrapping around the scope. */
  next(): void;
  previous(): void;
  /** Search the current term again (a failed page is retried on Enter). */
  refresh(): void;
  /** Abort everything and reset to idle (band closed). */
  close(): void;
}
