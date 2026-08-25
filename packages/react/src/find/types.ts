// The shared find contract (design/pluggable-find.md, "Core contract" +
// "Surface registration"). Types only — implementations live next door
// (coordinator) and in surface packages (default in-memory sources).

// ---- Anchors & matches ------------------------------------------------

export type FindAnchorKind = "event" | "message" | "row";

export interface FindAnchor {
  kind: FindAnchorKind;
  /** event uuid / message id / listing row id */
  id: string;
}

export interface FindMatch {
  anchor: FindAnchor;
  /** 0-based occurrence within the anchor's projected text. Omitted by
   *  anchor-granularity sources (log list): stepping is per-anchor and the
   *  surface highlights all in-anchor occurrences. */
  occurrence?: number;
  /** Optional hint: the anchor's position in scope order. Never required —
   *  navigation resolves anchors via the data layer (D8) — but lets a
   *  virtualizer aim before data arrives. */
  ordinal?: number;
}

// ---- Query ------------------------------------------------------------

export interface FindQuery {
  /** Matched as case-insensitive literal substring (D3). */
  text: string;
  /** View config shaping the universe. v1: this field only (D5). */
  excludedEventTypes?: string[];
  // future, capability-gated: regex, wordBoundary, caseSensitive
}

// ---- Results ----------------------------------------------------------

export interface FindTotal {
  value: number;
  relation: "eq" | "gte"; // "gte" renders as "10,000+" / "M+"
}

export type FindStreamItem =
  | { kind: "matches"; matches: FindMatch[] }
  /** Optional, for progressive sources (worker over still-loading data,
   *  server scanning a huge transcript). coverage in [0, 1]. */
  | { kind: "progress"; coverage: number }
  /** Terminal. complete=false means the universe wasn't fully seen
   *  (data still loading, cap hit) — the UI must not present the
   *  total as final. */
  | { kind: "end"; complete: boolean; total: FindTotal };

// ---- Source -----------------------------------------------------------

export interface FindCursor {
  /** Resume strictly after this position (or before, going backward). */
  anchor: FindAnchor;
  occurrence?: number;
}

export interface FindOptions {
  direction: "forward" | "backward";
  cursor?: FindCursor;
  /** Max matches to stream before ending with relation:"gte". */
  limit?: number;
}

export interface FindSource {
  readonly scopeId: string; // "transcript" | "messages" | "log-list" | "json" | ...
  readonly capabilities: {
    /** Source sees the entire universe (vs. best-effort over loaded data). */
    complete: boolean;
    // future: regex, wordBoundary, caseSensitive
  };
  find(
    query: FindQuery,
    opts: FindOptions,
    signal: AbortSignal
  ): AsyncIterable<FindStreamItem>;
}

// ---- Surface registration ----------------------------------------------

export type RevealOutcome =
  | "revealed" // anchor rendered; row will self-highlight
  | "missing"; // anchor can't render → coordinator scrolls near it and
// flashes (a jump is never silent, D10)

export interface FindSurface {
  scopeId: string;
  /** One source per scope. Composition (e.g. log list's listing query +
   *  local overlay; transcript's loaded data + live tail) happens inside
   *  the surface via a mergeFindSources() helper before registration. */
  source: FindSource;
  /** Perform whatever navigation reveals the match: switch swimlane row,
   *  expand collapsed ancestors, scroll (via the anchor-reveal primitive,
   *  D8). Must not require the anchor to be in memory. */
  reveal(match: FindMatch, signal: AbortSignal): Promise<RevealOutcome>;
}

export type FindDirection = "forward" | "backward";

/** Coordinator state consumed by FindBand and the per-row highlight hook. */
export interface FindState {
  /** Current search term ("" when idle). */
  term: string;
  /** Known match window — a contiguous run of matches in scope order. */
  matches: FindMatch[];
  /** Index of the active match within `matches`, or null. */
  activeIndex: number | null;
  /** Universe-wide total from the source; null before the first survey ends
   *  (interim totals over the growing window carry relation "gte"). */
  total: FindTotal | null;
  /** The source saw the entire universe (stream end's `complete`). */
  complete: boolean;
  /** Coverage in [0, 1] for progressive sources, null when not reported. */
  progress: number | null;
  /** A survey or window-extension query is in flight. */
  searching: boolean;
  /** The last finished survey found nothing for the current term. */
  noResults: boolean;
  /** Scope of the active (most recently registered) surface, or null. */
  scopeId: string | null;
  /** Direction of the last step — lets direction-sensitive reveal UI
   *  (e.g. the transcript headroom) mirror the user's intent. */
  lastDirection: FindDirection;
}

export interface FindCoordinator {
  registerSurface(surface: FindSurface): () => void;
  /** Start a new query (aborting any in-flight one). "" clears. */
  setTerm(term: string): void;
  /** Step to the next/previous match, wrapping around the scope. */
  next(): void;
  previous(): void;
  /** Abort everything and reset to idle (band closed). */
  close(): void;
}
