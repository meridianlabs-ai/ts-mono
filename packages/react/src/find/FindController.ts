import {
  findTabSwitchesWithin,
  getFindExpandHandle,
  type FindExpandHandle,
  type FindTabSwitchHandle,
} from "./expandRegistry";
import {
  countOccurrences,
  FIND_IGNORE_ATTR,
  lowerPreservingLength,
  rangeForOccurrence,
} from "./findText";
import type { FindSegment, FindSource } from "./types";

// Type-ahead debounce; 1-character terms never auto-search.
const AUTO_SEARCH_DEBOUNCE_MS = 200; // chosen-by-agent within spec's "~200ms"
const MIN_AUTO_SEARCH_CHARS = 2;

const HIGHLIGHT_NAME = "tsmono-find-current";

// Non-standard, so absent from lib.dom — present in Chromium (including the
// VS Code webview, which has no native find UI) and Firefox.
type WindowFindFn = (
  searchString: string,
  caseSensitive?: boolean,
  backwards?: boolean,
  wrapAround?: boolean
) => boolean;

export interface FindSnapshot {
  /** The find band is mounted; sources index their corpus only while true. */
  active: boolean;
  /** Input value (what the user typed). */
  term: string;
  /** Active searched term ("" = none). */
  query: string;
  /** Total matches for `query` (meaningful when not indexing). */
  total: number;
  /** 1-based position of the current match; 0 = none. */
  ordinal: number;
  /** Some registered source's corpus is still being built. */
  indexing: boolean;
  hasSources: boolean;
  /** Sourceless fallback (window.find) found nothing for the last action —
   *  the only signal that path publishes (it has no counts). */
  fallbackNoMatch: boolean;
}

interface PaintTarget {
  source: FindSource;
  key: string;
  occurrence: number;
  lowerTerm: string;
}

/** Single owner of find state: term, match counts, and cursor live here;
 *  the band's ordinal display and the painted highlight both derive from this
 *  state. The DOM is only consulted to place the Range for the already-chosen
 *  (segment, occurrence) — no information flows back from DOM to model. */
export class FindController {
  private sources = new Map<FindSource, () => void>();
  private listeners = new Set<() => void>();
  private snapshot: FindSnapshot = {
    active: false,
    term: "",
    query: "",
    total: 0,
    ordinal: 0,
    indexing: false,
    hasSources: false,
    fallbackNoMatch: false,
  };

  // Match table for the active query: per-segment occurrence counts and a
  // cumulative sum (nothing allocated per occurrence; the cursor ordinal
  // maps to (segment, occurrence) by binary search).
  private segSources: FindSource[] = [];
  private segKeys: string[] = [];
  private cumulative = new Uint32Array(0);
  private segmentCount = 0;
  private cursor = -1;
  private pendingAutoNavigate = false;
  // Matches counted so far. While counting these are matches in the stable
  // document-order extraction prefix, so their ordinals are already final;
  // once countFinal it equals the published total and wrapping enables.
  private knownTotal = 0;
  private countFinal = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Painting session.
  private target: PaintTarget | null = null;
  private currentRange: Range | null = null;
  private observer: MutationObserver | null = null;
  private observedContainer: HTMLElement | null = null;
  private revealedKey: string | null = null;
  private revealGeneration = 0;
  private pendingCenter = false;
  private centerAfterReveal = false;
  private expanded = new Set<FindExpandHandle>();
  private tabSwitches = new Map<FindTabSwitchHandle, Element>();
  private tabSwitchKey: string | null = null;

  // ----- store plumbing -------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FindSnapshot => this.snapshot;

  private publish(partial: Partial<FindSnapshot>): void {
    // No-op publishes must not notify: a subscriber re-render can retrigger
    // the corpus→recount→publish chain, and only value changes may loop it.
    let changed = false;
    for (const key of Object.keys(partial) as (keyof FindSnapshot)[]) {
      if (this.snapshot[key] !== partial[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...partial };
    for (const l of this.listeners) l();
  }

  // ----- source registration --------------------------------------------

  registerSource = (source: FindSource): (() => void) => {
    const unsubscribe = source.subscribe(() => this.refreshCorpus());
    this.sources.set(source, unsubscribe);
    this.refreshCorpus();
    return () => {
      unsubscribe();
      this.sources.delete(source);
      // The current match may have lived in this source — restart from the
      // top of what remains rather than pointing at a stale cursor.
      if (this.target && this.target.source === source) {
        this.clearPaintSession();
        this.pendingAutoNavigate = true;
      }
      this.refreshCorpus();
    };
  };

  // ----- input ------------------------------------------------------------

  /** Band mount lifecycle: activates corpus indexing; deactivation is the
   *  band-close teardown. */
  setActive = (active: boolean): void => {
    if (active === this.snapshot.active) return;
    if (active) {
      this.publish({ active: true });
    } else {
      this.deactivate();
    }
  };

  setTerm = (term: string): void => {
    this.publish({ term });
    this.cancelDebounce();
    if (term.length >= MIN_AUTO_SEARCH_CHARS) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.runQuery(term);
      }, AUTO_SEARCH_DEBOUNCE_MS);
    } else {
      this.clearQuery();
    }
  };

  /** Enter / F3 / Ctrl+G: explicit search. A changed term searches
   *  immediately (any length); otherwise steps the cursor. */
  step = (direction: 1 | -1): void => {
    // Always kill a pending type-ahead search: it would re-run the query
    // after this explicit navigation and yank the cursor back to match 1.
    this.cancelDebounce();
    const { term, query } = this.snapshot;
    if (term.length === 0) {
      if (query) this.clearQuery();
      return;
    }
    if (this.sources.size === 0) {
      // Sourceless fallback: window.find runs on explicit action only
      // (typing just records the term); it owns stepping and wrap, with the
      // document selection as its continuation anchor.
      if (term !== query) {
        this.publish({ query: term });
        // Anchor at the previous match's start so an extended term
        // (err → error) re-matches in place instead of walking forward.
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) selection.collapseToStart();
      }
      const found = this.windowFind(term, direction === -1);
      this.publish({ fallbackNoMatch: !found });
      return;
    }
    if (term !== query) {
      this.runQuery(term);
      return;
    }
    if (this.knownTotal === 0 || this.cursor === -1) {
      // No navigation yet for this query (e.g. finished indexing with 0
      // shown) — re-run so a corpus that changed since gets re-counted.
      this.runQuery(term);
      return;
    }
    if (this.countFinal) {
      const total = this.knownTotal;
      this.cursor = (this.cursor + direction + total) % total;
    } else {
      // Still counting: only step onto matches whose ordinals are already
      // final; past either end the press is a plain no-op — no wrap yet.
      const next = this.cursor + direction;
      if (next < 0 || next >= this.knownTotal) return;
      this.cursor = next;
    }
    this.publish({ ordinal: this.cursor + 1 });
    this.navigateToCursor();
  };

  /** Band-input blur: on the fallback path, fire the pending first search
   *  for a typed-but-unsearched term — focus has left the input, so
   *  window.find can no longer disturb typing. Unchanged term or sourced
   *  path (whose typing already searches): no-op. */
  flushFallbackTerm = (): void => {
    if (!this.snapshot.active || this.sources.size > 0) return;
    const { term, query } = this.snapshot;
    if (term.length === 0 || term === query) return;
    this.step(1);
  };

  /** Full teardown on band close: highlight, observers, expansions,
   *  query state. Corpus caches live in the sources and survive. */
  deactivate = (): void => {
    this.cancelDebounce();
    this.clearPaintSession();
    for (const source of this.sources.keys()) source.cleanup();
    this.cursor = -1;
    this.pendingAutoNavigate = false;
    this.knownTotal = 0;
    this.countFinal = false;
    this.publish({
      active: false,
      term: "",
      query: "",
      total: 0,
      ordinal: 0,
      fallbackNoMatch: false,
    });
  };

  // ----- query / counting -------------------------------------------------

  private cancelDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearQuery(): void {
    this.cancelDebounce();
    this.clearPaintSession();
    this.cursor = -1;
    this.pendingAutoNavigate = false;
    this.knownTotal = 0;
    this.countFinal = false;
    this.publish({ query: "", total: 0, ordinal: 0, fallbackNoMatch: false });
  }

  private runQuery(term: string): void {
    if (this.sources.size === 0) {
      // Typing only records the term on the fallback path: window.find moves
      // the selection (and can steal focus mid-word), so searching waits for
      // an explicit press or the input's blur. `query` stays empty — that is
      // the "typed but not yet searched" marker those triggers test.
      this.clearPaintSession();
      this.cursor = -1;
      this.pendingAutoNavigate = false;
      this.publish({
        query: "",
        total: 0,
        ordinal: 0,
        indexing: false,
        hasSources: false,
        fallbackNoMatch: false,
      });
      return;
    }
    this.clearPaintSession();
    this.cursor = -1;
    // A new search starts from the top — navigate to match 1 as soon as
    // counts exist (immediately, or when indexing completes).
    this.pendingAutoNavigate = true;
    this.publish({ query: term, ordinal: 0 });
    this.recount();
  }

  private refreshCorpus(): void {
    const hasSources = this.sources.size > 0;
    if (!this.snapshot.query) {
      const indexing = this.anyIndexing();
      if (
        hasSources !== this.snapshot.hasSources ||
        indexing !== this.snapshot.indexing
      ) {
        this.publish({ hasSources, indexing });
      }
      return;
    }
    this.recount();
  }

  private anyIndexing(): boolean {
    for (const source of this.sources.keys()) {
      if (source.getSegments() === null) return true;
    }
    return false;
  }

  private recount(): void {
    const query = this.snapshot.query;
    const lowerTerm = lowerPreservingLength(query);
    const hasSources = this.sources.size > 0;
    if (!query || !hasSources) {
      this.segmentCount = 0;
      this.knownTotal = 0;
      this.countFinal = false;
      this.publish({
        hasSources,
        indexing: false,
        total: 0,
        fallbackNoMatch: false,
      });
      return;
    }
    // Progressive counting: extraction is document-order, so matches in a
    // still-indexing source's extracted prefix already carry their final
    // ordinals. Count complete sources fully, then the FIRST incomplete
    // source's prefix, and stop — anything past an incomplete source would
    // renumber as that source grows.
    const stable: { source: FindSource; segments: readonly FindSegment[] }[] =
      [];
    let indexing = false;
    for (const source of this.sources.keys()) {
      const segments = source.getSegments();
      if (segments !== null) {
        stable.push({ source, segments });
        continue;
      }
      indexing = true;
      const prefix = source.getPrefixSegments?.();
      if (prefix && prefix.length > 0)
        stable.push({ source, segments: prefix });
      break;
    }
    let segTotal = 0;
    for (const entry of stable) segTotal += entry.segments.length;
    if (this.cumulative.length < segTotal) {
      this.cumulative = new Uint32Array(segTotal);
    }
    this.segSources.length = segTotal;
    this.segKeys.length = segTotal;
    let i = 0;
    let running = 0;
    for (const entry of stable) {
      for (const segment of entry.segments) {
        running += countOccurrences(segment.lowerText, lowerTerm);
        this.segSources[i] = entry.source;
        this.segKeys[i] = segment.key;
        this.cumulative[i] = running;
        i++;
      }
    }
    this.segmentCount = segTotal;
    this.knownTotal = running;
    this.countFinal = !indexing;
    // Totals publish atomically (0 until final); the band derives its
    // "k of Counting…" from ordinal + indexing while partial.
    const total = this.countFinal ? running : 0;
    if (this.countFinal && running === 0) this.clearPaintSession();
    // Live corpora renumber matches: keep the ordinal attached to the
    // PAINTED match (re-derive its position) rather than letting the number
    // drift onto a different occurrence.
    const repositioned = this.target ? this.ordinalOfTarget(this.target) : -1;
    if (repositioned !== -1) {
      this.cursor = repositioned;
    } else if (this.countFinal && this.cursor >= this.knownTotal) {
      // Clamp only on FINAL counts. While a later source is (re)indexing, a
      // landed cursor beyond its prefix keeps its ordinal — earlier sources
      // are complete, so that ordinal is still final and the growing prefix
      // will reach it again (clamping here caused a 6↔7 stepping orbit).
      this.cursor = this.knownTotal > 0 ? this.knownTotal - 1 : -1;
    }
    this.publish({
      hasSources,
      indexing,
      total,
      ordinal: this.cursor + 1,
      // Entering (or staying in) sourced mode invalidates any fallback state.
      fallbackNoMatch: false,
    });
    if (this.pendingAutoNavigate && this.knownTotal > 0) {
      this.pendingAutoNavigate = false;
      this.cursor = 0;
      this.publish({ ordinal: 1 });
      this.navigateToCursor();
    } else if (
      this.countFinal &&
      this.target &&
      repositioned === -1 &&
      this.cursor >= 0
    ) {
      // The painted match no longer exists (in a FINAL count — while
      // counting the target may simply not be in the prefix yet) but the
      // cursor ordinal does — re-resolve so number and paint agree. The new
      // target exists in the just-built table, so the next recount
      // repositions it (no repair loop). Corpus-driven, so it must not steal
      // scroll ownership the user already took (navigateToCursor re-arms
      // centering by default).
      const keepCenter = this.pendingCenter;
      this.navigateToCursor();
      if (!keepCenter) {
        this.pendingCenter = false;
        this.disarmUserTakeover();
      }
    }
  }

  /** Global ordinal of a (segment, occurrence) target in the CURRENT match
   *  table, or -1 when it no longer exists. */
  private ordinalOfTarget(target: PaintTarget): number {
    for (let i = 0; i < this.segmentCount; i++) {
      if (
        this.segKeys[i] === target.key &&
        this.segSources[i] === target.source
      ) {
        const before = i > 0 ? this.cumulative[i - 1]! : 0;
        const count = this.cumulative[i]! - before;
        return target.occurrence < count ? before + target.occurrence : -1;
      }
    }
    return -1;
  }

  private resolveCursor(): PaintTarget | null {
    const k = this.cursor;
    if (k < 0 || this.segmentCount === 0) return null;
    // First segment whose cumulative count exceeds k.
    let lo = 0;
    let hi = this.segmentCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid]! > k) hi = mid;
      else lo = mid + 1;
    }
    if (this.cumulative[lo]! <= k) return null;
    const before = lo > 0 ? this.cumulative[lo - 1]! : 0;
    const source = this.segSources[lo];
    const key = this.segKeys[lo];
    if (!source || key === undefined) return null;
    return {
      source,
      key,
      occurrence: k - before,
      lowerTerm: lowerPreservingLength(this.snapshot.query),
    };
  }

  // ----- painting -----------------------------------------------------------

  private navigateToCursor(): void {
    const target = this.resolveCursor();
    this.clearHighlightOnly();
    this.target = target;
    this.revealedKey = null;
    this.tabSwitchKey = null;
    this.revealGeneration++;
    this.pendingCenter = true;
    this.centerAfterReveal = false;
    this.armUserTakeover();
    if (target) this.attemptPaint();
  }

  /** Idempotent: called on navigation, on every container mutation batch and
   *  on reveal completion; cheap when the painted range is still valid. */
  private attemptPaint = (): void => {
    const target = this.target;
    if (!target) return;
    const container = target.source.getContainer();

    if (this.currentRange && this.rangeStillValid(this.currentRange, target)) {
      this.applyExpansions(this.currentRange, container);
      this.maybeCenter(container);
      return;
    }
    this.currentRange = null;

    const el = target.source.getElement(target.key);
    const range = el
      ? rangeForOccurrence(el, target.lowerTerm, target.occurrence)
      : null;
    if (!range) {
      // Row mounted but the occurrence isn't in its DOM: a diverted inner tab
      // may be hiding the corpus text — never triggered on tab identity, only
      // on this paint failure (a tab that renders the text paints as-is).
      if (el) this.switchDivertedTabs(el, target.key);
      if (this.revealedKey !== target.key) {
        this.revealedKey = target.key;
        this.centerAfterReveal = true;
        const generation = this.revealGeneration;
        target.source.reveal(target.key, () => {
          if (generation !== this.revealGeneration) return;
          // Reveal scroll settled: safe to center without fighting it.
          this.centerAfterReveal = false;
          this.attemptPaint();
        });
      }
      this.ensureObserver(container);
      return;
    }

    this.currentRange = range;
    this.paintHighlight(range);
    // Consume the tab-switch chance for this navigation: a user who diverts
    // the tab AFTER the match painted keeps their pick until the next step.
    this.tabSwitchKey = target.key;
    this.applyExpansions(range, container);
    this.restoreStaleTabSwitches(range);
    this.maybeCenter(container);
    // Keep observing for the whole session: virtualizer remounts and syntax
    // highlighting can replace the row/text nodes long after first paint.
    this.ensureObserver(container);
  };

  private rangeStillValid(range: Range, target: PaintTarget): boolean {
    if (!range.startContainer.isConnected) return false;
    return lowerPreservingLength(range.toString()) === target.lowerTerm;
  }

  /** Sourceless fallback: these screens are fully rendered, so one
   *  window.find call per action is the whole implementation — the document
   *  selection is its continuation anchor and must not be touched otherwise
   *  (and the sourced path never touches the selection at all). */
  // Continuation anchor for the sourceless fallback: the live document
  // selection is too fragile to be the record (Firefox's find steals focus,
  // refocusing the band input clears document selections) — each search
  // re-anchors at the previously painted match instead.
  private fallbackAnchor: Range | null = null;

  private windowFind(term: string, backwards: boolean): boolean {
    const find = (window as Window & { find?: WindowFindFn }).find;
    this.clearHighlightOnly();
    if (!find) return false;
    const anchor = this.fallbackAnchor;
    if (anchor && anchor.startContainer.isConnected) {
      const selection = window.getSelection();
      if (selection) {
        const from = anchor.cloneRange();
        // Forward continues after the match's end, backward before its start.
        from.collapse(backwards);
        selection.removeAllRanges();
        selection.addRange(from);
      }
    }
    // Engines disagree on wrapAround (Firefox never wraps backwards) — always
    // search without it and wrap by hand: on a miss, retry once from a
    // collapsed anchor at the document edge. Chromium honors that anchor;
    // Firefox ignores collapsed forward anchors at the very end and restarts
    // from the top, which is the same wrap.
    let range = this.findUsable(find, term, backwards);
    if (!range) {
      this.collapseSelectionAtEdge(backwards);
      range = this.findUsable(find, term, backwards);
    }
    if (range) {
      this.fallbackAnchor = range.cloneRange();
      // Chromium's window.find scrolls only the viewport, never inner
      // overflow:auto containers — and these apps scroll in those, so a
      // hidden landed match must be revealed by hand. Reveal, not center: a
      // match already on screen must not move (scrolling can flip
      // scroll-driven chrome like the sticky sample header's collapse state,
      // and the resulting re-render replaces the matched node under both the
      // selection and the highlight).
      this.centerRangeInScrollers(range, { onlyWhenHidden: true });
      // Firefox hides unfocused selections while the band input has focus —
      // mirror the landed selection with the shared highlight so the match
      // stays visible; cleared (above) when nothing is found.
      this.paintHighlight(range.cloneRange());
    }
    return range !== null;
  }

  /** One find pass, skipping unusable hits — both engines match the band's
   *  own input value (the term is always in there), each reporting it
   *  differently:
   *  - usable range inside find-ignored chrome (Chromium, focused input):
   *    plain continue, the next find starts past it;
   *  - collapsed empty range (Chromium, unfocused input): also plain
   *    continue — clearing here would reset Chromium's find state to the top
   *    and loop back onto the same hit;
   *  - NON-collapsed range with empty text (Firefox text-control selection):
   *    confines every further find to the control — must clear to break back
   *    out into the document. */
  private findUsable(
    find: WindowFindFn,
    term: string,
    backwards: boolean
  ): Range | null {
    // Unusable hits can be numerous (every match inside collapsed message
    // bodies is skipped), so hopping is unbounded and terminates on cycle
    // detection instead of a hop cap: without wrapAround each engine hit
    // advances through the document, but both engines can restart from the
    // top mid-pass (Firefox after the text-control escape below; Chromium
    // after its collapsed hit on the band input's value) — bailing when a
    // start position repeats covers every case, since positions are finite.
    const visited = new Map<Node, Set<number>>();
    for (;;) {
      if (!find(term, false, backwards, false)) return null;
      const selection = window.getSelection();
      const range =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      // Found but no range exposed: nothing to anchor the next hop on.
      if (!range) return null;
      const seen = visited.get(range.startContainer);
      if (seen) {
        if (seen.has(range.startOffset)) return null;
        seen.add(range.startOffset);
      } else {
        visited.set(range.startContainer, new Set([range.startOffset]));
      }
      if (range.collapsed) continue;
      if (range.toString().length === 0) {
        selection?.removeAllRanges();
        continue;
      }
      if (!this.rangeInIgnoredChrome(range) && !this.rangeInvisible(range)) {
        return range;
      }
    }
  }

  /** window.find can land on text the user cannot see — e.g. the navbar's
   *  collapsed-header slot, which duplicates the title under an opacity:0,
   *  overflow-hidden ancestor while the header is expanded. Such a landing
   *  paints nothing, so a step appears to do nothing; treat it like ignored
   *  chrome and hop past. Chromium's window.find scrolls only the viewport,
   *  never inner scrollers — in these fixed-viewport apps a below-the-fold
   *  match still sits outside every ancestor box when this runs — so a clip
   *  only counts against the match's REACHABLE position: a scrollable
   *  ancestor can move the match anywhere within its own box (windowFind
   *  does that reveal scroll after acceptance). */
  private rangeInvisible(range: Range): boolean {
    let rect: DOMRect = range.getBoundingClientRect();
    // <=1px: collapsed/zero-geometry text has no visible glyphs (1px guards
    // rounding on genuinely hidden boxes; real glyph boxes are far larger).
    if (rect.width <= 1 || rect.height <= 1) return true;
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    for (let el = start; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.opacity === "0" || style.visibility === "hidden") return true;
      // Fully outside an unscrollable clip box on either axis: hidden/clip
      // overflow never scroll-reveals, so the match can never come on screen.
      const clipX = style.overflowX === "hidden" || style.overflowX === "clip";
      const clipY = style.overflowY === "hidden" || style.overflowY === "clip";
      if (clipX || clipY) {
        const box = el.getBoundingClientRect();
        if (clipY && (rect.bottom <= box.top || rect.top >= box.bottom)) {
          return true;
        }
        if (clipX && (rect.right <= box.left || rect.left >= box.right)) {
          return true;
        }
      }
      // Past a scrollable ancestor the match's current coordinates are
      // meaningless to outer clips — scrolling can place it anywhere in the
      // scroller's box, so that box (per scrollable axis) is what outer
      // ancestors must judge.
      const scrollableY =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 1;
      const scrollableX =
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth + 1;
      if (scrollableX || scrollableY) {
        const box = el.getBoundingClientRect();
        rect = new DOMRect(
          scrollableX ? box.x : rect.x,
          scrollableY ? box.y : rect.y,
          scrollableX ? box.width : rect.width,
          scrollableY ? box.height : rect.height
        );
      }
    }
    return false;
  }

  private rangeInIgnoredChrome(range: Range): boolean {
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    for (let el = start; el; el = el.parentElement) {
      if (el.hasAttribute(FIND_IGNORE_ATTR)) return true;
    }
    return false;
  }

  private collapseSelectionAtEdge(atEnd: boolean): void {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(document.body);
    range.collapse(!atEnd);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private paintHighlight(range: Range): void {
    // Feature-detected: hosts without the Custom Highlight API keep full find
    // navigation, just without the visual indicator.
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
  }

  private clearHighlightOnly(): void {
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
    this.currentRange = null;
  }

  private clearPaintSession(): void {
    this.clearHighlightOnly();
    this.fallbackAnchor = null;
    this.disconnectObserver();
    this.disarmUserTakeover();
    this.target = null;
    this.revealedKey = null;
    this.revealGeneration++;
    this.pendingCenter = false;
    this.centerAfterReveal = false;
    for (const handle of this.expanded) handle.collapse();
    this.expanded.clear();
    for (const handle of this.tabSwitches.keys()) handle.restore();
    this.tabSwitches.clear();
    this.tabSwitchKey = null;
  }

  private switchDivertedTabs(rowEl: Element, key: string): void {
    // Once per navigation: re-switching would fight a user who re-picked a
    // tab while parked on this match.
    if (this.tabSwitchKey === key) return;
    this.tabSwitchKey = key;
    for (const [element, handle] of findTabSwitchesWithin(rowEl)) {
      if (handle.isDiverted()) {
        handle.switchToDefault();
        this.tabSwitches.set(handle, element);
      }
    }
  }

  /** Return panels the current match turned out not to live in (a row can
   *  hold several tabbed panels; all diverted ones were switched blind) to the
   *  user's tab; the one hosting the range stays until step-away/close. */
  private restoreStaleTabSwitches(range: Range): void {
    for (const [handle, element] of this.tabSwitches) {
      if (!element.contains(range.startContainer)) {
        handle.restore();
        this.tabSwitches.delete(handle);
      }
    }
  }

  private applyExpansions(range: Range, container: HTMLElement | null): void {
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const path = new Set<FindExpandHandle>();
    for (let el = start; el && el !== container; el = el.parentElement) {
      const handle = getFindExpandHandle(el);
      if (handle) path.add(handle);
    }
    for (const handle of path) {
      if (handle.isClipped()) {
        handle.expand();
        this.expanded.add(handle);
      }
    }
    // Expansions strictly track the current match — collapse what the
    // previous match needed (safe no-op if that panel unmounted meanwhile).
    for (const handle of [...this.expanded]) {
      if (!path.has(handle)) {
        handle.collapse();
        this.expanded.delete(handle);
      }
    }
  }

  private maybeCenter(container: HTMLElement | null): void {
    if (!this.pendingCenter || this.centerAfterReveal) return;
    if (!this.currentRange) return;
    // A collapsed clip ancestor is mid-expansion: its commit's class/style
    // mutation re-triggers attemptPaint, which centers then.
    if (this.anyClippedAncestor(this.currentRange, container)) return;
    const range = this.currentRange;
    if (range.getBoundingClientRect().height === 0) return;
    // pendingCenter stays armed for the whole match: scrolling mounts
    // unmeasured virtualizer rows whose real heights land in LATER commits
    // and shift content long after any single pass converges, so every
    // mutation round re-centers until the user takes over (wheel/touch/
    // mousedown/scroll keys — see armUserTakeover) or the next navigation.
    this.centerRangeInScrollers(range);
  }

  /** Center `range` across EVERY scrollable ancestor, innermost first (a
   *  match can sit inside a scrollable code block inside the virtualized
   *  list — only scrolling the nearest one leaves the outer view unmoved).
   *  `onlyWhenHidden`: leave a match that is already fully inside a
   *  scroller's box alone — reveal, don't recenter. */
  private centerRangeInScrollers(
    range: Range,
    { onlyWhenHidden = false }: { onlyWhenHidden?: boolean } = {}
  ): void {
    for (
      let el = range.startContainer.parentElement;
      el && el !== document.body;
      el = el.parentElement
    ) {
      const style = getComputedStyle(el);
      const scrollableY =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 1;
      const scrollableX =
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth + 1;
      if (!scrollableY && !scrollableX) continue;
      const rect = range.getBoundingClientRect();
      const scrollerRect = el.getBoundingClientRect();
      if (
        scrollableY &&
        !(
          onlyWhenHidden &&
          rect.top >= scrollerRect.top &&
          rect.bottom <= scrollerRect.bottom
        )
      ) {
        const delta =
          rect.top + rect.height / 2 - (scrollerRect.top + el.clientHeight / 2);
        if (Math.abs(delta) > 2) el.scrollTop += delta;
      }
      // Horizontal only when the match is actually outside the scroller's
      // horizontal view (wide code blocks) — no jiggling for prose.
      if (
        scrollableX &&
        (rect.left < scrollerRect.left || rect.right > scrollerRect.right)
      ) {
        el.scrollLeft +=
          rect.left + rect.width / 2 - (scrollerRect.left + el.clientWidth / 2);
      }
    }
  }

  // Keys that scroll content — a press means the user owns the viewport now.
  private static readonly SCROLL_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
  ]);

  private releaseCenter = (e: Event): void => {
    if (
      e.type === "keydown" &&
      !FindController.SCROLL_KEYS.has((e as KeyboardEvent).key)
    ) {
      return;
    }
    this.pendingCenter = false;
    this.disarmUserTakeover();
  };

  private takeoverArmed = false;

  private armUserTakeover(): void {
    if (this.takeoverArmed) return;
    this.takeoverArmed = true;
    document.addEventListener("wheel", this.releaseCenter, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", this.releaseCenter, {
      capture: true,
      passive: true,
    });
    document.addEventListener("mousedown", this.releaseCenter, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", this.releaseCenter, {
      capture: true,
      passive: true,
    });
  }

  private disarmUserTakeover(): void {
    if (!this.takeoverArmed) return;
    this.takeoverArmed = false;
    document.removeEventListener("wheel", this.releaseCenter, true);
    document.removeEventListener("touchmove", this.releaseCenter, true);
    document.removeEventListener("mousedown", this.releaseCenter, true);
    document.removeEventListener("keydown", this.releaseCenter, true);
  }

  private anyClippedAncestor(
    range: Range,
    container: HTMLElement | null
  ): boolean {
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    for (let el = start; el && el !== container; el = el.parentElement) {
      const handle = getFindExpandHandle(el);
      if (handle?.isClipped()) return true;
    }
    return false;
  }

  private onResourceLoad = (): void => {
    this.attemptPaint();
  };

  private ensureObserver(container: HTMLElement | null): void {
    if (!container) return;
    if (this.observer && this.observedContainer === container) return;
    this.disconnectObserver();
    this.observer = new MutationObserver(() => this.attemptPaint());
    // attributes: expansion/collapse is often a class/style-only change with
    // no childList/characterData record.
    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    // Image/media loads reflow content WITHOUT any DOM mutation — catch them
    // in the capture phase (load doesn't bubble) so centering self-corrects.
    document.addEventListener("load", this.onResourceLoad, true);
    this.observedContainer = container;
  }

  private disconnectObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.observedContainer) {
      document.removeEventListener("load", this.onResourceLoad, true);
    }
    this.observedContainer = null;
  }
}
