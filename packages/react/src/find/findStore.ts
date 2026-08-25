import type {
  FindCoordinator,
  FindDirection,
  FindMatch,
  FindState,
  FindStreamItem,
  FindSurface,
  FindTotal,
} from "./types";

// Survey cap (~1–2k per VS Code/xterm precedent, design doc open question 5).
// The window holds up to this many matches from one term-change query;
// stepping past it issues cursor calls of STEP_LIMIT.
export const FIND_SURVEY_LIMIT = 2000;
export const FIND_STEP_LIMIT = 200;

const INITIAL_STATE: FindState = {
  term: "",
  matches: [],
  activeIndex: null,
  total: null,
  complete: false,
  progress: null,
  searching: false,
  noResults: false,
  scopeId: null,
  lastDirection: "forward",
};

function sameMatch(a: FindMatch, b: FindMatch): boolean {
  return (
    a.anchor.kind === b.anchor.kind &&
    a.anchor.id === b.anchor.id &&
    a.occurrence === b.occurrence
  );
}

/**
 * The find coordinator's store: registry of FindSurfaces plus the query /
 * match-window / navigation state FindBand and the row highlighter consume.
 * Framework-free; FindProvider owns one instance and exposes it via context.
 *
 * Window model: `matches` is a contiguous run of matches in scope order.
 * A term change issues one survey (forward, no cursor, FIND_SURVEY_LIMIT);
 * stepping inside the window is local; stepping past an edge issues cursor
 * calls that extend it; wrapping past a known universe edge re-windows from
 * the opposite end. Enter always steps through known matches immediately —
 * an in-flight query never blocks navigation.
 */
export class FindStore implements FindCoordinator {
  private state: FindState = INITIAL_STATE;
  private listeners = new Set<() => void>();
  private surfaces: FindSurface[] = [];

  // Window-edge knowledge, private to the stepping logic.
  private windowAtStart = true;
  private windowAtEnd = false;

  // The most recently activated match, kept OUTSIDE state so it survives
  // surface re-registration (React cleanup+setup unregisters before the
  // replacement registers): invalidation surveys relocate it in the fresh
  // window instead of yanking the user back to the first match.
  private lastActive: FindMatch | null = null;

  private queryAbort: AbortController | null = null;
  private revealAbort: AbortController | null = null;
  private extending = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): FindState => this.state;

  private set(partial: Partial<FindState>): void {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  }

  private activeSurface(): FindSurface | null {
    return this.surfaces[this.surfaces.length - 1] ?? null;
  }

  registerSurface(surface: FindSurface): () => void {
    this.surfaces.push(surface);
    this.onSurfacesChanged();
    return () => {
      const i = this.surfaces.indexOf(surface);
      if (i !== -1) {
        this.surfaces.splice(i, 1);
        this.onSurfacesChanged();
      }
    };
  }

  // Match state is keyed on (scope, query, view config): a surface change —
  // tab switch, or the same surface re-registering because its data/filter
  // changed — invalidates the window and re-surveys the current term.
  private onSurfacesChanged(): void {
    const surface = this.activeSurface();
    const scopeId = surface?.scopeId ?? null;
    this.abortQueries();
    if (this.state.term && surface) {
      this.set({ scopeId });
      this.survey("invalidate");
    } else {
      this.set({
        ...INITIAL_STATE,
        term: this.state.term,
        lastDirection: this.state.lastDirection,
        scopeId,
      });
    }
  }

  setTerm(term: string): void {
    if (term === this.state.term) return;
    this.abortQueries();
    this.lastActive = null;
    if (!term || !this.activeSurface()) {
      this.set({
        ...INITIAL_STATE,
        term,
        scopeId: this.state.scopeId,
        lastDirection: this.state.lastDirection,
      });
      return;
    }
    this.set({ term });
    this.survey("term");
  }

  next(): void {
    this.step("forward");
  }

  previous(): void {
    this.step("backward");
  }

  close(): void {
    this.abortQueries();
    this.lastActive = null;
    this.set({
      ...INITIAL_STATE,
      scopeId: this.state.scopeId,
    });
  }

  dispose(): void {
    this.abortQueries();
    this.listeners.clear();
  }

  private abortQueries(): void {
    this.queryAbort?.abort();
    this.queryAbort = null;
    this.revealAbort?.abort();
    this.revealAbort = null;
    this.extending = false;
  }

  // ---- Querying ---------------------------------------------------------

  /** Fire-and-forget wrapper: collect() handles its own failures and the
   *  callers drive everything through the onMatches/onEnd callbacks. */
  private runCollect(...args: Parameters<FindStore["collect"]>): void {
    this.collect(...args).catch(() => undefined);
  }

  private async collect(
    surface: FindSurface,
    opts: { direction: FindDirection; cursor?: FindMatch; limit: number },
    signal: AbortSignal,
    onMatches: (matches: FindMatch[]) => void,
    onEnd: (end: { complete: boolean; total: FindTotal }) => void
  ): Promise<void> {
    const stream = surface.source.find(
      { text: this.state.term },
      {
        direction: opts.direction,
        ...(opts.cursor
          ? {
              cursor: {
                anchor: opts.cursor.anchor,
                ...(opts.cursor.occurrence !== undefined
                  ? { occurrence: opts.cursor.occurrence }
                  : {}),
              },
            }
          : {}),
        limit: opts.limit,
      },
      signal
    );
    try {
      for await (const item of stream) {
        if (signal.aborted) return;
        this.applyStreamItem(item, signal, onMatches, onEnd);
      }
    } catch {
      // A failed source ends the search quietly; the band shows whatever
      // was streamed. Aborts land here too (iterators may throw the reason).
      if (!signal.aborted) this.set({ searching: false });
    }
  }

  private applyStreamItem(
    item: FindStreamItem,
    signal: AbortSignal,
    onMatches: (matches: FindMatch[]) => void,
    onEnd: (end: { complete: boolean; total: FindTotal }) => void
  ): void {
    if (signal.aborted) return;
    if (item.kind === "matches") onMatches(item.matches);
    else if (item.kind === "progress") this.set({ progress: item.coverage });
    else onEnd({ complete: item.complete, total: item.total });
  }

  /**
   * One survey per term change / invalidation: forward from the top, no
   * cursor. reason "term" activates (and reveals) the first match as it
   * arrives — the type-ahead navigation cmd+f users expect. reason
   * "invalidate" (data changed under the same term) relocates the previous
   * active match without revealing, so live updates never yank the scroll.
   */
  private survey(reason: "term" | "invalidate"): void {
    const surface = this.activeSurface();
    if (!surface || !this.state.term) return;
    this.abortQueries();
    const ac = new AbortController();
    this.queryAbort = ac;
    const prevActive =
      reason === "invalidate" ? (this.lastActive ?? undefined) : undefined;
    this.windowAtStart = true;
    this.windowAtEnd = false;
    this.set({
      matches: [],
      activeIndex: null,
      total: null,
      complete: false,
      progress: null,
      searching: true,
      noResults: false,
    });
    let received = 0;
    this.runCollect(
      surface,
      { direction: "forward", limit: FIND_SURVEY_LIMIT },
      ac.signal,
      (incoming) => {
        received += incoming.length;
        const matches = [...this.state.matches, ...incoming];
        let activeIndex = this.state.activeIndex;
        if (activeIndex === null && matches.length > 0) {
          if (prevActive) {
            const i = matches.findIndex((m) => sameMatch(m, prevActive));
            if (i !== -1) activeIndex = i;
          } else if (reason === "term") {
            activeIndex = 0;
            this.lastActive = matches[0]!;
            this.reveal(matches[0]!);
          }
        }
        this.set({
          matches,
          activeIndex,
          total: { value: matches.length, relation: "gte" },
        });
      },
      (end) => {
        // An exact total is authoritative: the window reaches the universe
        // end iff it covers all matches. Without one, a part-filled page
        // proves the scan ran out (a source may cap pages below the
        // requested limit, so a full page proves nothing either way).
        this.windowAtEnd =
          end.total.relation === "eq"
            ? received >= end.total.value
            : received < FIND_SURVEY_LIMIT;
        this.set({
          searching: false,
          total: end.total,
          complete: end.complete,
          noResults: end.total.value === 0 && this.state.matches.length === 0,
        });
      }
    );
  }

  // ---- Stepping -----------------------------------------------------------

  private step(direction: FindDirection): void {
    const st = this.state;
    if (!st.term || !this.activeSurface()) return;
    if (st.lastDirection !== direction) this.set({ lastDirection: direction });
    const len = st.matches.length;
    // Nothing known yet: the in-flight survey activates the first match on
    // arrival — progress never blocks navigation, there's just nothing to
    // navigate to yet.
    if (len === 0) return;
    const idx = this.state.activeIndex;
    if (direction === "forward") {
      if (idx === null) {
        this.activate(0);
      } else if (idx + 1 < len) {
        this.activate(idx + 1);
      } else if (this.windowAtEnd) {
        if (this.windowAtStart)
          this.activate(0); // local wrap
        else this.rewindow("start"); // wrap to universe start
      } else {
        this.extend("forward");
      }
    } else {
      if (idx === null) {
        this.activate(len - 1);
      } else if (idx > 0) {
        this.activate(idx - 1);
      } else if (this.windowAtStart) {
        if (this.windowAtEnd)
          this.activate(len - 1); // local wrap
        else this.rewindow("end"); // wrap to universe end
      } else {
        this.extend("backward");
      }
    }
  }

  private activate(index: number): void {
    const match = this.state.matches[index];
    if (!match) return;
    this.lastActive = match;
    this.set({ activeIndex: index });
    this.reveal(match);
  }

  /**
   * Whether a window mutation reached the far universe edge. An exact total
   * is authoritative when the window is anchored at the opposite edge
   * (window length then equals coverage); otherwise a part-filled page
   * proves the scan ran out — a full page proves nothing, since sources may
   * cap pages below the requested limit.
   */
  private coversEdge(
    total: FindTotal,
    windowLength: number,
    anchoredAtOppositeEdge: boolean,
    pageLength: number
  ): boolean {
    if (total.relation === "eq" && anchoredAtOppositeEdge) {
      return windowLength >= total.value;
    }
    return pageLength < FIND_STEP_LIMIT && total.relation !== "eq";
  }

  /** Extend the window past its edge with a cursor call. */
  private extend(direction: FindDirection): void {
    if (this.extending || this.state.searching) return;
    const surface = this.activeSurface();
    if (!surface) return;
    const st = this.state;
    const cursor =
      direction === "forward"
        ? st.matches[st.matches.length - 1]
        : st.matches[0];
    if (!cursor) return;
    this.extending = true;
    this.queryAbort?.abort();
    const ac = new AbortController();
    this.queryAbort = ac;
    const collected: FindMatch[] = [];
    this.runCollect(
      surface,
      { direction, cursor, limit: FIND_STEP_LIMIT },
      ac.signal,
      (incoming) => collected.push(...incoming),
      (end) => {
        this.extending = false;
        if (collected.length === 0) {
          // Nothing beyond the window: it already touched this universe
          // edge — record that and re-step, which now wraps.
          if (direction === "forward") this.windowAtEnd = true;
          else this.windowAtStart = true;
          this.set({ total: end.total, complete: end.complete });
          this.step(direction);
          return;
        }
        if (direction === "forward") {
          const matches = [...this.state.matches, ...collected];
          this.windowAtEnd = this.coversEdge(
            end.total,
            matches.length,
            this.windowAtStart,
            collected.length
          );
          this.set({ matches, total: end.total, complete: end.complete });
          this.activate(matches.length - collected.length);
        } else {
          // Backward pages arrive in backward order; prepend reversed.
          const reversed = [...collected].reverse();
          const matches = [...reversed, ...this.state.matches];
          this.windowAtStart = this.coversEdge(
            end.total,
            matches.length,
            this.windowAtEnd,
            collected.length
          );
          this.set({ matches, total: end.total, complete: end.complete });
          this.activate(reversed.length - 1);
        }
      }
    );
  }

  /** Replace the window from a universe edge (wrap-around past a far edge). */
  private rewindow(edge: "start" | "end"): void {
    if (this.extending || this.state.searching) return;
    const surface = this.activeSurface();
    if (!surface) return;
    this.extending = true;
    this.queryAbort?.abort();
    const ac = new AbortController();
    this.queryAbort = ac;
    const direction: FindDirection = edge === "start" ? "forward" : "backward";
    const collected: FindMatch[] = [];
    this.runCollect(
      surface,
      { direction, limit: FIND_STEP_LIMIT },
      ac.signal,
      (incoming) => collected.push(...incoming),
      (end) => {
        this.extending = false;
        const coversAll = this.coversEdge(
          end.total,
          collected.length,
          true,
          collected.length
        );
        if (edge === "start") {
          this.windowAtStart = true;
          this.windowAtEnd = coversAll;
          this.set({
            matches: collected,
            total: end.total,
            complete: end.complete,
          });
          this.activate(0);
        } else {
          this.windowAtEnd = true;
          this.windowAtStart = coversAll;
          const matches = [...collected].reverse();
          this.set({ matches, total: end.total, complete: end.complete });
          this.activate(matches.length - 1);
        }
      }
    );
  }

  // ---- Reveal ---------------------------------------------------------------

  private reveal(match: FindMatch): void {
    const surface = this.activeSurface();
    if (!surface) return;
    this.revealAbort?.abort();
    const ac = new AbortController();
    this.revealAbort = ac;
    // Outcome "missing" is tolerated here: the surface has already scrolled
    // as close as it can, and the row-level highlighter flashes whatever
    // does render (D10). Sources project only revealable anchors, so this
    // is a defensive path, not a steady state.
    void surface.reveal(match, ac.signal).catch(() => undefined);
  }
}
