import type { FindDirection, FindSource } from "./ExtendedFindContext";
import { findScrollableParent, scrollRangeToCenter } from "./findBandDom";
import { clearFindHighlights, paintFindHighlights } from "./findHighlights";
import { findTextMatches } from "./findMatches";
import {
  buildEntries,
  keyAt,
  MatchEntry,
  MatchKey,
  ordinalOf,
  rangeOf,
  SourceMatches,
  totalMatches,
} from "./findModel";

export interface FindStatus {
  term: string;
  total: number;
  /** 0-based ordinal of the current match, null before one is chosen. */
  ordinal: number | null;
}

interface FindSessionOptions {
  /** The page text to search. */
  root: Element;
  sources: () => ReadonlyMap<string, FindSource>;
  /** Mutations inside this element (the band) don't change the matches. */
  band: () => Element | null;
  onStatus: (status: FindStatus) => void;
}

// How long a revealed item may take to render its text (markdown and syntax
// highlighting are asynchronous) before a step skips past it.
const REVEAL_SETTLE_MS = 1000;
// Consecutive items a single step may skip because they render no match.
const MAX_SKIPS = 10;
const USER_SCROLL_EVENTS = ["wheel", "touchmove", "pointerdown"] as const;

/**
 * Find state for one open find band: the matches for the current term, the
 * current match, and the highlights. Lives outside React because it reacts
 * to DOM mutations and list reveals, not renders.
 */
export class FindSession {
  private term = "";
  private entries: MatchEntry[] = [];
  private current: { key: MatchKey; ordinal: number } | null = null;
  // The current match should scroll into view once it is rendered.
  private scrollPending = false;
  // The current match's item isn't rendered yet: its list is bringing it
  // into the DOM (`inFlight`), or it is rendered and its text may follow.
  private revealing: {
    direction: FindDirection;
    skips: number;
    inFlight: boolean;
  } | null = null;
  private navigation = 0;
  private abortReveal: AbortController | null = null;
  private settleTimer: number | null = null;
  private frame: number | null = null;
  private observer: MutationObserver | null = null;

  constructor(private readonly options: FindSessionOptions) {
    for (const type of USER_SCROLL_EVENTS) {
      document.addEventListener(type, this.onUserInput, {
        capture: true,
        passive: true,
      });
    }
  }

  get searchTerm(): string {
    return this.term;
  }

  setTerm(term: string): void {
    if (term === this.term) return;
    const previous = this.currentRange();
    this.term = term;
    this.current = null;
    this.cancelNavigation();
    this.observe(term !== "");
    this.rebuild();
    this.selectFrom(previous?.startContainer.isConnected ? previous : null);
  }

  step(direction: FindDirection): void {
    const total = totalMatches(this.entries);
    if (total === 0) return;
    const ordinal = this.current
      ? this.current.ordinal + (direction === "forward" ? 1 : -1)
      : direction === "forward"
        ? 0
        : total - 1;
    this.navigate(ordinal, direction, 0);
  }

  /** Re-collects matches, e.g. after a list's data changed. */
  refresh(): void {
    this.scheduleRebuild();
  }

  dispose(): void {
    for (const type of USER_SCROLL_EVENTS) {
      document.removeEventListener(type, this.onUserInput, { capture: true });
    }
    this.cancelNavigation();
    this.observe(false);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    clearFindHighlights();
  }

  private observe(on: boolean): void {
    if (!on) {
      this.observer?.disconnect();
      this.observer = null;
      return;
    }
    if (this.observer) return;
    this.observer = new MutationObserver((records) => {
      const band = this.options.band();
      if (band && records.every((r) => band.contains(r.target))) return;
      this.scheduleRebuild();
    });
    this.observer.observe(this.options.root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private scheduleRebuild(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.rebuild();
    });
  }

  /** Re-collects the matches from the page and the sources, then publishes. */
  private rebuild(): void {
    const previous = this.currentRange();
    this.entries = this.term ? this.collect(this.term) : [];
    if (this.current?.key.source === null && previous) {
      this.current.key = reanchorPageMatch(
        this.entries,
        this.current.key,
        previous
      );
    }
    this.publish();
  }

  /** Resolves the current match against the collected matches, paints the
   *  highlights, scrolls if a navigation is waiting, and reports status. */
  private publish(): void {
    const total = totalMatches(this.entries);
    if (this.current) {
      const ordinal = ordinalOf(this.entries, this.current.key);
      if (ordinal !== null) {
        this.current.ordinal = ordinal;
      } else if (!this.revealing) {
        const key = keyAt(
          this.entries,
          Math.min(this.current.ordinal, total - 1)
        );
        this.current = key
          ? { key, ordinal: ordinalOf(this.entries, key)! }
          : null;
      }
    }
    const range = this.currentRange();
    // Until the list's own scroll to the item settles, it would undo ours.
    const listScrolling = this.revealing?.inFlight === true;
    if (range && this.revealing && !listScrolling) {
      this.revealing = null;
      this.clearSettleTimer();
    }
    paintFindHighlights(this.allRanges(), range);
    if (range && this.scrollPending && !listScrolling) {
      this.scrollPending = false;
      this.scrollAfterLayout(this.navigation);
    }
    this.options.onStatus({
      term: this.term,
      total,
      ordinal: this.current?.ordinal ?? null,
    });
  }

  private collect(term: string): MatchEntry[] {
    const ranges = findTextMatches(this.options.root, term);
    const sources = [...this.options.sources()]
      .map(([id, source]) => ({ id, source, anchor: source.anchor() }))
      .filter(
        (s): s is { id: string; source: FindSource; anchor: Element } =>
          s.anchor !== null
      );
    const rendered = new Map<string, Map<number, Range[]>>(
      sources.map((s) => [s.id, new Map()])
    );
    const pageRanges: Range[] = [];
    for (const range of ranges) {
      const owner = ownerOf(sources, range.startContainer);
      if (owner) {
        const items = rendered.get(owner.id)!;
        const list = items.get(owner.item);
        if (list) list.push(range);
        else items.set(owner.item, [range]);
      } else {
        pageRanges.push(range);
      }
    }
    const matches: SourceMatches[] = sources.map(({ id, source, anchor }) => ({
      id,
      position: pageMatchesBefore(pageRanges, anchor),
      dataCounts: source.countByItem(term),
      rendered: rendered.get(id)!,
      renderedItems: source.renderedItems(),
    }));
    return buildEntries(pageRanges, matches);
  }

  /** Chooses the first match at or after `from`, or else the first one not
   *  above the viewport, so typing doesn't jump the page back to the top. */
  private selectFrom(from: Range | null): void {
    let ordinal = 0;
    const seenRendered = new Set<string | null>();
    for (const entry of this.entries) {
      if (entry.ranges) {
        seenRendered.add(entry.source);
        const index = entry.ranges.findIndex((range) =>
          from
            ? range.compareBoundaryPoints(Range.START_TO_START, from) >= 0
            : !isAboveViewport(range)
        );
        if (index !== -1) {
          this.navigate(ordinal + index, "forward", 0);
          return;
        }
      } else if (seenRendered.has(entry.source)) {
        // An item past the list's rendered rows is below the viewport.
        this.navigate(ordinal, "forward", 0);
        return;
      }
      ordinal += entry.count;
    }
    this.navigate(0, "forward", 0);
  }

  private navigate(ordinal: number, direction: FindDirection, skips: number) {
    const key = keyAt(this.entries, ordinal);
    if (!key) return;
    this.cancelNavigation();
    const navigation = this.navigation;
    this.current = { key, ordinal: ordinalOf(this.entries, key)! };
    this.scrollPending = true;
    const source =
      key.source === null ? undefined : this.options.sources().get(key.source);
    if (rangeOf(this.entries, key) || !source) {
      this.publish();
      return;
    }
    this.revealing = { direction, skips, inFlight: true };
    this.publish();
    const settle = (rendered: boolean) => {
      if (navigation !== this.navigation || !this.revealing) return;
      this.revealing.inFlight = false;
      this.rebuild();
      if (this.currentRange()) return;
      if (!rendered) {
        this.skipUnrevealed(navigation);
        return;
      }
      this.settleTimer = window.setTimeout(() => {
        this.settleTimer = null;
        if (navigation !== this.navigation) return;
        this.rebuild();
        this.skipUnrevealed(navigation);
      }, REVEAL_SETTLE_MS);
    };
    this.abortReveal = new AbortController();
    source
      .reveal(key.item, direction, this.abortReveal.signal)
      .then(settle, () => {
        if (navigation === this.navigation) this.stopNavigating();
      });
  }

  // The user scrolling or clicking the page while a navigation is still
  // bringing its match in takes over: the view stays where they put it.
  private readonly onUserInput = (event: Event): void => {
    if (!this.revealing && !this.scrollPending) return;
    const band = this.options.band();
    if (band && event.target instanceof Node && band.contains(event.target)) {
      return;
    }
    this.stopNavigating();
  };

  // Something else took over the scroll (the user, a restore): keep the
  // current match, leave the view where it is, and don't move on.
  private stopNavigating(): void {
    this.cancelNavigation();
    this.publish();
  }

  // The item never rendered, or rendered none of the text its data matched:
  // step past all of its matches in the same direction.
  private skipUnrevealed(navigation: number): void {
    const revealing = this.revealing;
    if (!revealing || !this.current || navigation !== this.navigation) return;
    this.revealing = null;
    if (revealing.skips >= MAX_SKIPS) {
      this.scrollPending = false;
      return;
    }
    const { key } = this.current;
    const start = ordinalOf(this.entries, { ...key, occurrence: 0 });
    const count =
      this.entries.find((e) => e.source === key.source && e.item === key.item)
        ?.count ?? 0;
    // A vanished item's ordinal now belongs to the match after it.
    const from = start ?? this.current.ordinal;
    const ordinal = revealing.direction === "forward" ? from + count : from - 1;
    this.navigate(ordinal, revealing.direction, revealing.skips + 1);
  }

  // Two frames: a match's panel expands (FindTarget) in the render that
  // follows the term change, which moves the match.
  private scrollAfterLayout(navigation: number): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (navigation !== this.navigation) return;
        const range = this.currentRange();
        if (range) scrollRangeIntoViewIfNeeded(range);
      })
    );
  }

  private cancelNavigation(): void {
    this.navigation++;
    this.abortReveal?.abort();
    this.abortReveal = null;
    this.revealing = null;
    this.scrollPending = false;
    this.clearSettleTimer();
  }

  private clearSettleTimer(): void {
    if (this.settleTimer !== null) {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private currentRange(): Range | null {
    return this.current ? rangeOf(this.entries, this.current.key) : null;
  }

  private allRanges(): Range[] {
    return this.entries.flatMap((entry) => entry.ranges ?? []);
  }
}

// Page matches are keyed by index, which shifts when page text above the
// current match appears or goes (e.g. a list without a find source rendering
// more rows). Follow the match's own text position instead.
function reanchorPageMatch(
  entries: readonly MatchEntry[],
  key: MatchKey,
  previous: Range
): MatchKey {
  if (!previous.startContainer.isConnected) return key;
  const entry = entries.find(
    (e) =>
      e.source === null &&
      e.ranges?.[0]?.startContainer === previous.startContainer &&
      e.ranges[0].startOffset === previous.startOffset
  );
  return entry ? { ...key, item: entry.item } : key;
}

function ownerOf(
  sources: readonly { id: string; source: FindSource }[],
  node: Node
): { id: string; item: number } | null {
  for (const { id, source } of sources) {
    const item = source.itemOf(node);
    if (item !== null) return { id, item };
  }
  return null;
}

function pageMatchesBefore(pageRanges: readonly Range[], anchor: Element) {
  const after =
    Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY;
  const index = pageRanges.findIndex(
    (range) =>
      (anchor.compareDocumentPosition(range.startContainer) & after) !== 0
  );
  return index === -1 ? pageRanges.length : index;
}

function viewportOf(range: Range): { top: number; bottom: number } {
  const parent = findScrollableParent(range.startContainer.parentElement, {
    minScrollBuffer: 0,
  });
  if (parent) {
    const rect = parent.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }
  return { top: 0, bottom: window.innerHeight };
}

function isAboveViewport(range: Range): boolean {
  return range.getBoundingClientRect().bottom <= viewportOf(range).top;
}

function scrollRangeIntoViewIfNeeded(range: Range): void {
  const rect = range.getBoundingClientRect();
  const viewport = viewportOf(range);
  if (rect.top >= viewport.top && rect.bottom <= viewport.bottom) return;
  scrollRangeToCenter(range);
}
