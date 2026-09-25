import type {
  FindAnchor,
  FindCoordinator,
  FindPage,
  FindReveal,
  FindRow,
  FindSource,
  FindState,
  FindSurface,
} from "./types";

export const FIND_IDLE_STATE: FindState = {
  term: "",
  rows: [],
  activeRow: null,
  activeOccurrence: null,
  activeOrdinal: null,
  count: null,
  exact: false,
  noResults: false,
  error: null,
  scopeId: null,
};

type FindDirection = "forward" | "backward";

interface ActivePosition {
  row: number;
  occurrence: number;
}

/** Where the user was before a re-scan, so it can put them back. */
interface Previous {
  scopeId: string;
  anchorId: string;
  index: number;
  occurrence: number;
}

/** One forward walk over the source's matching rows, page by page. */
interface Scan {
  ac: AbortController;
  rows: FindRow[];
  /** Walked off the source's current end (the exact end when `sealed`). */
  done: boolean;
  sealed: boolean;
  /** While set, the rows on screen stay the old ones until the scan reaches
   *  the row the user is on (the value is the fallback when no row is
   *  active on screen, e.g. after a re-register). */
  relocate: Previous | null;
}

/**
 * The registered FindSurface plus the query, matching rows and navigation.
 *
 * A term scans the source forward from the top, one page after another,
 * and keeps every matching row, so "N of M" is a position in that list and
 * M grows page by page (M+ until the scan walks off a sealed source).
 * Stepping is local; a step past the known rows waits for the next page
 * (steps accumulate as a signed count meanwhile) and past the end of a
 * finished scan it wraps. A data or source change, or a same-scope
 * re-register, re-scans while the old rows stay on screen, then puts the
 * user back on their row by anchor without scrolling (else on the nearest
 * row by index, scrolled to). Only an activation (first hit, step, wrap,
 * that fallback) reveals: it asks the surface to bring the row in and holds
 * one reveal for the row's highlighter to claim. Inside a row the step
 * count is its DOM match count while it is mounted and has reported, the
 * source's count otherwise; a row rendering none of its matches is skipped.
 */
export class FindStore implements FindCoordinator {
  private state: FindState = FIND_IDLE_STATE;
  private listeners = new Set<() => void>();
  private surface: FindSurface | null = null;
  private term = "";
  private rows: FindRow[] = [];
  private scanDone = false;
  private sealed = false;
  private error: string | null = null;
  private active: ActivePosition | null = null;
  private scan: Scan | null = null;
  /** Kept across an unregister so a same-scope re-register (a tab switch)
   *  lands back on the row; a different scope discards it. */
  private lastActive: Previous | null = null;
  private mounted = new Set<string>();
  private domCounts = new Map<string, number>();
  private revealAbort: AbortController | null = null;
  /** The last activation's reveal, until its row claims it. */
  private pendingReveal: { anchorId: string; kind: FindReveal } | null = null;
  /** Steps waiting for rows the scan has not delivered: +1 forward, -1 back. */
  private pending = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): FindState => this.state;

  private publish(): void {
    const next: FindState = {
      term: this.term,
      rows: this.rows,
      activeRow: this.active?.row ?? null,
      activeOccurrence: this.active?.occurrence ?? null,
      activeOrdinal: this.ordinal(),
      count: this.count(),
      exact: this.scanDone && this.sealed,
      noResults: this.scanDone && this.rows.length === 0,
      error: this.error,
      scopeId: this.surface?.scopeId ?? null,
    };
    // React cleanup+setup pairs re-register the same surface; publishing an
    // unchanged snapshot would re-render every consumer for nothing.
    if (
      this.state.term === next.term &&
      this.state.rows === next.rows &&
      this.state.activeRow === next.activeRow &&
      this.state.activeOccurrence === next.activeOccurrence &&
      this.state.activeOrdinal === next.activeOrdinal &&
      this.state.count === next.count &&
      this.state.exact === next.exact &&
      this.state.noResults === next.noResults &&
      this.state.error === next.error &&
      this.state.scopeId === next.scopeId
    ) {
      return;
    }
    this.state = next;
    for (const l of this.listeners) l();
  }

  /** Matches found so far; null until the first page has landed. */
  private count(): number | null {
    if (this.rows.length === 0 && !this.scanDone) return null;
    let occurrences = 0;
    for (const row of this.rows) occurrences += row.count;
    return occurrences;
  }

  private stepCount(row: FindRow): number {
    return this.domCounts.get(row.anchor.id) ?? row.count;
  }

  /** The active occurrence's position in source counts; null while the
   *  active row renders no match (it flashes instead). */
  private ordinal(): number | null {
    const active = this.active;
    if (!active) return null;
    const activeRow = this.rows[active.row]!;
    if (this.stepCount(activeRow) === 0) return null;
    let before = 0;
    for (let i = 0; i < active.row; i++) before += this.rows[i]!.count;
    const within = Math.min(
      active.occurrence,
      Math.max(activeRow.count - 1, 0)
    );
    return before + within;
  }

  registerSurface(surface: FindSurface): () => void {
    this.setSurface(surface);
    return () => {
      if (this.surface === surface) this.setSurface(null);
    };
  }

  updateSource(scopeId: string, source: FindSource): void {
    const surface = this.surface;
    if (!surface || surface.scopeId !== scopeId || surface.source === source)
      return;
    surface.source = source;
    if (this.term) this.startScan(this.relocation());
  }

  invalidate(scopeId: string): void {
    if (this.surface?.scopeId !== scopeId || !this.term) return;
    this.startScan(this.relocation());
  }

  /** Where a re-scan should put the user: the active row, or the row a
   *  re-scan already in flight is still looking for. */
  private relocation(): Previous | null {
    return this.position() ?? this.scan?.relocate ?? null;
  }

  attachRow(anchorId: string): () => void {
    this.mounted.add(anchorId);
    return () => {
      this.mounted.delete(anchorId);
      this.forgetRowCount(anchorId);
    };
  }

  reportRowCount(anchorId: string, count: number | null): void {
    if (!this.mounted.has(anchorId)) return;
    if (count === null) {
      this.forgetRowCount(anchorId);
      return;
    }
    if (this.domCounts.get(anchorId) === count) return;
    this.domCounts.set(anchorId, count);
    this.clampActive(anchorId, count);
    this.publish();
  }

  /** Back to the source count: clamp the active occurrence to it. */
  private forgetRowCount(anchorId: string): void {
    if (!this.domCounts.delete(anchorId)) return;
    const active = this.active;
    if (active) this.clampActive(anchorId, this.rows[active.row]!.count);
    this.publish();
  }

  private clampActive(anchorId: string, count: number): void {
    const active = this.active;
    if (
      active &&
      this.rows[active.row]!.anchor.id === anchorId &&
      active.occurrence >= count
    ) {
      active.occurrence = Math.max(count - 1, 0);
    }
  }

  private setSurface(surface: FindSurface | null): void {
    const previous = this.relocation() ?? this.lastActive;
    const relocate =
      surface && previous?.scopeId !== surface.scopeId ? null : previous;
    const reveal = this.pendingReveal;
    this.surface = surface;
    this.reset();
    this.lastActive = surface === null ? previous : null;
    // A reveal the relocation's row never claimed (it was still paging in
    // when the tab flipped) is kept for it to claim on mount; without it the
    // return would leave the active match off screen.
    if (reveal !== null && reveal.anchorId === relocate?.anchorId) {
      this.pendingReveal = reveal;
    }
    this.publish();
    if (surface && this.term) this.startScan(relocate);
  }

  claimReveal(anchorId: string): FindReveal | null {
    const reveal = this.pendingReveal;
    if (reveal === null || reveal.anchorId !== anchorId) return null;
    this.pendingReveal = null;
    return reveal.kind;
  }

  setTerm(term: string): void {
    if (term === this.term) return;
    this.reset();
    this.lastActive = null;
    this.term = term;
    this.publish();
    if (term && this.surface) this.startScan(null);
  }

  next(): void {
    this.step("forward");
  }

  previous(): void {
    this.step("backward");
  }

  /** Run the current term again (Enter after a failed page). */
  refresh(): void {
    if (this.term && this.surface) this.startScan(this.relocation());
  }

  close(): void {
    this.reset();
    this.lastActive = null;
    this.term = "";
    this.publish();
  }

  dispose(): void {
    this.abortAll();
    this.listeners.clear();
  }

  private position(): Previous | null {
    const active = this.active;
    const scopeId = this.surface?.scopeId;
    if (!active || scopeId === undefined) return null;
    const row = this.rows[active.row]!;
    return {
      scopeId,
      anchorId: row.anchor.id,
      index: row.index,
      occurrence: active.occurrence,
    };
  }

  private abortAll(): void {
    this.scan?.ac.abort();
    this.scan = null;
    this.revealAbort?.abort();
    this.revealAbort = null;
    this.pending = 0;
  }

  private reset(): void {
    this.abortAll();
    this.rows = [];
    this.scanDone = false;
    this.sealed = false;
    this.error = null;
    this.active = null;
    this.pendingReveal = null;
    this.domCounts.clear();
  }

  // ---- Scanning -----------------------------------------------------------

  /** Walk the source from the top. With `relocate`, the rows on screen stay
   *  until the scan reaches that row (by anchor, or past its index), then
   *  the user is put back there; without it the first page replaces them. */
  private startScan(relocate: Previous | null): void {
    this.scan?.ac.abort();
    this.scan = {
      ac: new AbortController(),
      rows: [],
      done: false,
      sealed: false,
      relocate,
    };
    this.error = null;
    if (!relocate) {
      this.rows = [];
      this.scanDone = false;
      this.active = null;
    }
    this.publish();
    this.fetchPage(this.scan, undefined);
  }

  private fetchPage(scan: Scan, after: FindAnchor | undefined): void {
    const surface = this.surface;
    if (!surface) return;
    surface.source.find({ text: this.term }, after, scan.ac.signal).then(
      (page) => {
        if (this.scan !== scan) return;
        this.onPage(scan, page);
      },
      (error: unknown) => {
        if (this.scan !== scan) return;
        this.error = error instanceof Error ? error.message : String(error);
        this.scan = null;
        this.pending = 0;
        // What the scan found stays usable and shows as M+; a scan that
        // found nothing leaves the state as it was.
        if (scan.rows.length > 0) {
          scan.done = true;
          scan.sealed = false;
          this.commit(scan);
        }
        this.publish();
      }
    );
  }

  private onPage(scan: Scan, page: FindPage): void {
    const known = scan.rows[scan.rows.length - 1];
    const first = page.rows[0];
    // A page that does not advance past the cursor (a source ignoring it)
    // would loop forever; stop with what we have.
    const stuck =
      known !== undefined && first !== undefined && first.index <= known.index;
    scan.rows = stuck ? scan.rows : scan.rows.concat(page.rows);
    scan.sealed = page.complete;
    scan.done = page.atEnd || stuck;
    if (scan.done) this.scan = null;
    this.commit(scan);
    this.drain();
    this.publish();
    if (!scan.done) {
      const last = scan.rows[scan.rows.length - 1];
      if (last) this.fetchPage(scan, last.anchor);
      else this.fetchPage(scan, undefined);
    }
  }

  /** Publish the scan's rows: right away when nothing on screen is kept,
   *  else once the scan has reached the user's row (or ended). */
  private commit(scan: Scan): void {
    const previous = scan.relocate && (this.position() ?? scan.relocate);
    if (previous) {
      const at = scan.rows.findIndex((r) => r.anchor.id === previous.anchorId);
      const last = scan.rows[scan.rows.length - 1];
      const passed = last !== undefined && last.index >= previous.index;
      if (at === -1 && !passed && !scan.done) return;
      scan.relocate = null;
      this.rows = scan.rows;
      this.scanDone = scan.done;
      this.sealed = scan.sealed;
      if (at !== -1) {
        // Same row: keep the occurrence (clamped) and the view; the list
        // restores its own scroll position on a return to the tab.
        const max = Math.max(this.stepCount(this.rows[at]!) - 1, 0);
        this.active = {
          row: at,
          occurrence: Math.min(previous.occurrence, max),
        };
      } else {
        this.active = null;
        const nearest = this.nearestByIndex(previous.index);
        if (nearest !== null) this.activateRow(nearest, "forward");
      }
      return;
    }
    this.rows = scan.rows;
    this.scanDone = scan.done;
    this.sealed = scan.sealed;
    if (this.active === null && this.pending === 0) {
      const first = this.nextRow(-1, "forward");
      if (first !== null) this.activateRow(first, "forward");
    }
  }

  private nearestByIndex(index: number): number | null {
    let best: number | null = null;
    let distance = Infinity;
    this.rows.forEach((row, i) => {
      const d = Math.abs(row.index - index);
      if (d < distance && this.stepCount(row) > 0) {
        best = i;
        distance = d;
      }
    });
    return best;
  }

  // ---- Stepping -----------------------------------------------------------

  private step(direction: FindDirection): void {
    if (!this.term || !this.surface) return;
    this.pending += direction === "forward" ? 1 : -1;
    this.drain();
    this.publish();
  }

  /** Apply pending steps until none remain or one needs rows not yet
   *  scanned; those stay pending for the next page. */
  private drain(): void {
    while (this.pending !== 0) {
      if (this.scanDone && this.rows.length === 0) {
        this.pending = 0;
        return;
      }
      const direction = this.pending > 0 ? "forward" : "backward";
      if (!this.tryStep(direction)) return;
      this.pending -= this.pending > 0 ? 1 : -1;
    }
  }

  /** The nearest row past `from` in `direction` that still has matches to
   *  step through, or null at the edge of the known rows. */
  private nextRow(from: number, direction: FindDirection): number | null {
    const step = direction === "forward" ? 1 : -1;
    for (let i = from + step; i >= 0 && i < this.rows.length; i += step) {
      if (this.stepCount(this.rows[i]!) > 0) return i;
    }
    return null;
  }

  /** One step; false when it needs rows the scan has not delivered yet. */
  private tryStep(direction: FindDirection): boolean {
    const active = this.active;
    const forward = direction === "forward";
    if (active) {
      const count = this.stepCount(this.rows[active.row]!);
      if (forward && active.occurrence + 1 < count) {
        this.activate(active.row, active.occurrence + 1);
        return true;
      }
      if (!forward && active.occurrence > 0 && count > 0) {
        this.activate(active.row, Math.min(active.occurrence - 1, count - 1));
        return true;
      }
    }
    // Entering from the end needs the end: wait for the scan.
    if (!active && !forward && (!this.scanDone || this.scan !== null)) {
      return false;
    }
    const from = active ? active.row : forward ? -1 : this.rows.length;
    const row = this.nextRow(from, direction);
    if (row !== null) {
      this.activateRow(row, direction);
      return true;
    }
    // Wrap only when no scan can still add rows past this edge.
    if (!this.scanDone || this.scan !== null) return false;
    const wrapped = this.nextRow(forward ? -1 : this.rows.length, direction);
    if (wrapped !== null) this.activateRow(wrapped, direction);
    return true;
  }

  /** Enter a row from the direction of travel: its first occurrence going
   *  forward, its last going backward. */
  private activateRow(row: number, direction: FindDirection): void {
    const count = this.stepCount(this.rows[row]!);
    this.activate(row, direction === "forward" ? 0 : Math.max(count - 1, 0));
  }

  private activate(row: number, occurrence: number): void {
    const target = this.rows[row];
    if (!target || !this.surface) return;
    this.active = { row, occurrence: Math.max(occurrence, 0) };
    this.pendingReveal = {
      anchorId: target.anchor.id,
      kind: this.mounted.has(target.anchor.id) ? "mounted" : "jumped",
    };
    this.publish();
    this.revealAbort?.abort();
    this.revealAbort = new AbortController();
    this.surface.reveal(target, this.revealAbort.signal);
  }
}
