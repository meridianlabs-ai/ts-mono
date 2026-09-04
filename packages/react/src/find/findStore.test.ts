import { describe, expect, it, vi } from "vitest";

import { FindStore } from "./findStore";
import type {
  FindAnchor,
  FindPage,
  FindQuery,
  FindRow,
  FindSource,
  FindSurface,
} from "./types";

const row = (id: string, count = 1, index = 0): FindRow => ({
  anchor: { id },
  index,
  count,
  texts: ["x"],
});

const rows = (n: number, count = 1, prefix = "m") =>
  Array.from({ length: n }, (_, i) => row(`${prefix}${i}`, count, i));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** [activeRow, activeOccurrence, activeOrdinal, count] */
const pos = (store: FindStore) => {
  const st = store.getState();
  return [st.activeRow, st.activeOccurrence, st.activeOrdinal, st.count];
};

const activeId = (store: FindStore) => {
  const st = store.getState();
  return st.activeRow === null ? null : st.rows[st.activeRow]!.anchor.id;
};

interface FakeSurfaceOptions {
  /** Report every page as `complete: false` (a sample still being written). */
  live?: boolean;
  /** Rows per page (the source's own cap). */
  pageSize?: number;
  /** Hold each page until this promise resolves. */
  gate?: Promise<void>;
  /** Hold only the calls after this many (1 = every call but the first). */
  gateAfter?: number;
}

/** A source over `all` (mutable: tests append or replace rows to simulate a
 *  live sample) that pages strictly after the cursor. */
function makeSurface(
  scopeId: string,
  all: FindRow[],
  options: FakeSurfaceOptions = {}
): {
  surface: FindSurface;
  reveal: ReturnType<typeof vi.fn>;
  calls: (string | undefined)[];
} {
  const calls: (string | undefined)[] = [];
  const source: FindSource = {
    async find(_query: FindQuery, after: FindAnchor | undefined) {
      calls.push(after?.id);
      if (options.gate && calls.length > (options.gateAfter ?? 0)) {
        await options.gate;
      }
      const at = after ? all.findIndex((r) => r.anchor.id === after.id) : -1;
      const start = at + 1;
      const page = all.slice(start, start + (options.pageSize ?? all.length));
      return {
        rows: page,
        atEnd: start + page.length >= all.length,
        complete: !options.live,
      };
    },
  };
  const reveal = vi.fn();
  return { surface: { scopeId, source, reveal }, reveal, calls };
}

describe("FindStore", () => {
  it("scans on term change: keeps the rows, counts, reveals the first row", async () => {
    const store = new FindStore();
    const { surface, reveal } = makeSurface("messages", [
      row("a", 2),
      row("b"),
      row("c"),
    ]);
    store.registerSurface(surface);

    store.setTerm("x");
    await flush();

    const st = store.getState();
    expect(st.rows).toHaveLength(3);
    expect(pos(store)).toEqual([0, 0, 0, 4]);
    expect(st.exact).toBe(true);
    expect(st.noResults).toBe(false);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(row("a", 2), expect.any(AbortSignal));
  });

  it("pages until the end: M is a lower bound until the last page of a sealed sample", async () => {
    const store = new FindStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { surface, calls } = makeSurface("messages", rows(5), {
      pageSize: 2,
      gate,
      gateAfter: 1,
    });
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();
    expect(store.getState().rows.map((r) => r.anchor.id)).toEqual(["m0", "m1"]);
    expect(pos(store)).toEqual([0, 0, 0, 2]);
    expect(store.getState().exact).toBe(false);
    // Stepping inside the known rows does not wait for the scan.
    store.next();
    expect(pos(store)).toEqual([1, 0, 1, 2]);

    release();
    await flush();
    expect(store.getState().rows).toHaveLength(5);
    expect(pos(store)).toEqual([1, 0, 1, 5]);
    expect(store.getState().exact).toBe(true);
    expect(calls).toEqual([undefined, "m1", "m3"]);
  });

  it("reports noResults once the scan reaches the end with nothing", async () => {
    const store = new FindStore();
    const { surface, reveal } = makeSurface("messages", []);
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();
    expect(store.getState()).toMatchObject({
      noResults: true,
      count: 0,
      exact: true,
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("a live sample is never exact, even after the scan reached its current end", async () => {
    const store = new FindStore();
    const { surface } = makeSurface("messages", rows(3), { live: true });
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();
    expect(pos(store)).toEqual([0, 0, 0, 3]);
    expect(store.getState().exact).toBe(false);
    expect(store.getState().noResults).toBe(false);
  });

  it("hides the count until the first page lands", async () => {
    const store = new FindStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { surface } = makeSurface("messages", rows(2), { gate });
    store.registerSurface(surface);
    store.setTerm("x");
    expect(store.getState().count).toBeNull();
    expect(store.getState().noResults).toBe(false);
    release();
    await flush();
    expect(store.getState().count).toBe(2);
  });

  it("steps through a row's occurrences by the source count, then into the next row, wrapping locally", async () => {
    const store = new FindStore();
    const { surface, reveal } = makeSurface("messages", [
      row("a", 2),
      row("b"),
    ]);
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();

    store.next();
    expect(pos(store)).toEqual([0, 1, 1, 3]);
    store.next();
    expect(pos(store)).toEqual([1, 0, 2, 3]);
    store.next();
    expect(pos(store)).toEqual([0, 0, 0, 3]);
    store.previous();
    expect(pos(store)).toEqual([1, 0, 2, 3]);
    store.previous();
    expect(pos(store)).toEqual([0, 1, 1, 3]);
    // Every activation reveals its row (the row centres the occurrence).
    expect(reveal).toHaveBeenCalledTimes(6);
  });

  it("steps a rendered row by its DOM count while N stays in source counts", async () => {
    const store = new FindStore();
    const { surface } = makeSurface("messages", [row("a", 3), row("b")]);
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();
    store.next();
    store.next();
    expect(pos(store)).toEqual([0, 2, 2, 4]);

    // Only a mounted row's count is kept.
    store.reportRowCount("a", 2);
    expect(pos(store)).toEqual([0, 2, 2, 4]);
    store.attachRow("a");

    // Fewer DOM matches than the source counted: clamp, and move on earlier.
    store.reportRowCount("a", 2);
    expect(pos(store)).toEqual([0, 1, 1, 4]);
    store.next();
    expect(pos(store)).toEqual([1, 0, 3, 4]);
    store.previous();
    expect(pos(store)).toEqual([0, 1, 1, 4]);

    // More DOM matches than counted: step through them all, N stops rising.
    store.reportRowCount("a", 5);
    store.next();
    store.next();
    expect(pos(store)).toEqual([0, 3, 2, 4]);
    store.next();
    expect(pos(store)).toEqual([0, 4, 2, 4]);
    store.next();
    expect(pos(store)).toEqual([1, 0, 3, 4]);
  });

  it("a row that renders none of its matches has no ordinal and is skipped afterwards", async () => {
    const store = new FindStore();
    const { surface } = makeSurface("messages", [
      row("a"),
      row("b", 2),
      row("c"),
    ]);
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();
    store.next();
    expect(pos(store)).toEqual([1, 0, 1, 4]);

    store.attachRow("b");
    store.reportRowCount("b", 0);
    expect(pos(store)).toEqual([1, 0, null, 4]);
    store.next();
    expect(pos(store)).toEqual([2, 0, 3, 4]);
    store.previous();
    expect(pos(store)).toEqual([0, 0, 0, 4]);
    store.previous();
    expect(pos(store)).toEqual([2, 0, 3, 4]);
  });

  describe("steps taken before the rows exist", () => {
    it("Enter during the first page lands on 1 of M; mashed Enter counts on from there", async () => {
      const store = new FindStore();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { surface, reveal } = makeSurface("messages", rows(5), { gate });
      store.registerSurface(surface);
      store.setTerm("x");
      store.next();
      expect(store.getState().activeRow).toBeNull();

      release();
      await flush();
      expect(pos(store)).toEqual([0, 0, 0, 5]);
      expect(reveal).toHaveBeenCalledTimes(1);

      store.setTerm("xy");
      store.next();
      store.next();
      store.next();
      await flush();
      expect(pos(store)).toEqual([2, 0, 2, 5]);
    });

    it("Shift+Enter before any row waits for the scan to finish, then enters from the end", async () => {
      const store = new FindStore();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { surface } = makeSurface("messages", rows(5, 2), {
        pageSize: 2,
        gate,
        gateAfter: 1,
      });
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      expect(pos(store)).toEqual([0, 0, 0, 4]);
      store.previous();
      // Two rows known, the end is not: the step waits.
      expect(pos(store)).toEqual([0, 0, 0, 4]);
      release();
      await flush();
      expect(activeId(store)).toBe("m4");
      expect(pos(store)).toEqual([4, 1, 9, 10]);
    });

    it("Shift+Enter pressed before the first page lands still waits for the scan's end", async () => {
      const store = new FindStore();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { surface } = makeSurface("messages", rows(5), {
        pageSize: 2,
        gate,
        gateAfter: 1,
      });
      store.registerSurface(surface);
      store.setTerm("x");
      store.previous(); // before any row is known
      await flush();
      // First page (m0, m1) landed; the end is unknown: nothing is active yet.
      expect(pos(store)).toEqual([null, null, null, 2]);
      release();
      await flush();
      expect(activeId(store)).toBe("m4");
    });

    it("Enter past the known rows waits for the next page, then continues; an opposite step cancels it", async () => {
      const store = new FindStore();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { surface } = makeSurface("messages", rows(6), {
        pageSize: 3,
        gate,
        gateAfter: 1,
      });
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.next();
      store.next();
      store.next(); // past m2: waits for the second page
      expect(pos(store)).toEqual([2, 0, 2, 3]);
      store.previous(); // nets the waiting step to zero
      store.next();
      store.next();
      store.previous(); // net +1 waiting
      release();
      await flush();
      expect(pos(store)).toEqual([3, 0, 3, 6]);
    });

    it("wraps only once the scan is done: Enter at the last known row waits, then wraps to the first", async () => {
      const store = new FindStore();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { surface, calls } = makeSurface("messages", rows(2), {
        live: true,
        pageSize: 2,
        gate,
        gateAfter: 1,
      });
      // A live source reports atEnd on the page that reaches its current end.
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.next();
      store.next();
      await flush();
      expect(pos(store)).toEqual([0, 0, 0, 2]);
      expect(calls).toEqual([undefined]);
      release();
    });
  });

  it("aborts the in-flight query when the term changes and drops its page even when it lands last", async () => {
    const store = new FindStore();
    const gates = new Map<string, () => void>();
    const signals: AbortSignal[] = [];
    const reveal = vi.fn();
    const surface: FindSurface = {
      scopeId: "messages",
      source: {
        async find(query, _after, signal) {
          signals.push(signal);
          // A source that ignores the signal: the page still arrives.
          await new Promise<void>((resolve) => gates.set(query.text, resolve));
          const rows = query.text === "x" ? [row("stale")] : [row("fresh")];
          return { rows, atEnd: true, complete: true };
        },
      },
      reveal,
    };
    store.registerSurface(surface);
    store.setTerm("x");
    store.setTerm("xy");
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    gates.get("xy")!();
    await flush();
    expect(store.getState().rows.map((r) => r.anchor.id)).toEqual(["fresh"]);
    gates.get("x")!();
    await flush();
    expect(store.getState().term).toBe("xy");
    expect(store.getState().rows.map((r) => r.anchor.id)).toEqual(["fresh"]);
    expect(pos(store)).toEqual([0, 0, 0, 1]);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).not.toHaveBeenCalledWith(
      row("stale"),
      expect.any(AbortSignal)
    );
  });

  describe("re-scan on source or data change", () => {
    it("relocates the active row by anchor without revealing when the source is swapped", async () => {
      const store = new FindStore();
      const { surface, reveal } = makeSurface("messages", [
        row("a"),
        row("b", 3),
      ]);
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.next();
      store.next();
      expect(pos(store)).toEqual([1, 1, 2, 4]);
      reveal.mockClear();

      const swapped = makeSurface("messages", [
        row("z"),
        row("a"),
        row("b", 3),
      ]);
      store.updateSource("messages", swapped.surface.source);
      await flush();
      expect(pos(store)).toEqual([2, 1, 3, 5]);
      expect(reveal).not.toHaveBeenCalled();
    });

    it("clamps the relocated occurrence when the row shrank, and reveals the first row when the active one vanished", async () => {
      const store = new FindStore();
      const { surface, reveal } = makeSurface("messages", [
        row("a"),
        row("b", 3),
      ]);
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.next();
      store.next();
      store.next();
      expect(pos(store)).toEqual([1, 2, 3, 4]);

      store.updateSource(
        "messages",
        makeSurface("messages", [row("a"), row("b", 1)]).surface.source
      );
      await flush();
      expect(pos(store)).toEqual([1, 0, 1, 2]);

      reveal.mockClear();
      store.updateSource(
        "messages",
        makeSurface("messages", [row("c"), row("d")]).surface.source
      );
      await flush();
      expect(pos(store)).toEqual([0, 0, 0, 2]);
      expect(reveal).toHaveBeenCalledWith(row("c"), expect.any(AbortSignal));
    });

    it("invalidate re-scans a live sample, keeping the active row; other scopes are ignored", async () => {
      const store = new FindStore();
      const all = [row("a"), row("b")];
      const { surface, calls } = makeSurface("messages", all, { live: true });
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.next();
      all.unshift(row("z"));
      store.invalidate("messages");
      store.invalidate("other");
      await flush();
      expect(calls).toHaveLength(2);
      expect(pos(store)).toEqual([2, 0, 2, 3]);
    });

    it("keeps the old rows on screen until the re-scan reaches the active row, then puts the user back on it", async () => {
      const store = new FindStore();
      const all = rows(1100);
      const { surface, reveal } = makeSurface("messages", all, {
        live: true,
        pageSize: 1000,
      });
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.previous(); // wrap to the end of the running sample
      await flush();
      expect(activeId(store)).toBe("m1099");
      expect(pos(store)).toEqual([1099, 0, 1099, 1100]);
      reveal.mockClear();

      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow = makeSurface("messages", all, {
        live: true,
        pageSize: 1000,
        gate,
        gateAfter: 1,
      });
      // Poll: a row appended; the first page of the re-scan does not hold
      // the active row, so nothing on screen changes yet.
      all.push(row("m1100", 1, 1100));
      store.updateSource("messages", slow.surface.source);
      await flush();
      expect(store.getState().rows).toHaveLength(1100);
      expect(activeId(store)).toBe("m1099");
      release();
      await flush();
      expect(store.getState().rows).toHaveLength(1101);
      expect(activeId(store)).toBe("m1099");
      expect(pos(store)).toEqual([1099, 0, 1099, 1101]);
      expect(reveal).not.toHaveBeenCalled();
      store.next();
      expect(activeId(store)).toBe("m1100");
    });

    it("relocates to the nearest row by index when the active row no longer matches", async () => {
      const store = new FindStore();
      const all = [row("a", 1, 2), row("b", 1, 7), row("c", 1, 12)];
      const { surface, reveal } = makeSurface("messages", all, { live: true });
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.next();
      expect(pos(store)[0]).toBe(1);
      reveal.mockClear();

      all.splice(1, 1, row("d", 1, 9));
      store.invalidate("messages");
      await flush();
      expect(activeId(store)).toBe("d");
      expect(reveal).toHaveBeenCalledWith(
        row("d", 1, 9),
        expect.any(AbortSignal)
      );
    });

    it("a live sample that reseals under new ids lands on the nearest row by index", async () => {
      const store = new FindStore();
      const all = rows(8);
      const { surface } = makeSurface("messages", all, { live: true });
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.previous();
      await flush();
      expect(activeId(store)).toBe("m7");
      all.splice(0, all.length, ...rows(9, 1, "n"));
      store.invalidate("messages");
      await flush();
      expect(activeId(store)).toBe("n7");
      expect(pos(store)).toEqual([7, 0, 7, 9]);
    });

    it("applies steps taken during a re-scan after relocating", async () => {
      const store = new FindStore();
      const { surface } = makeSurface("messages", [row("a"), row("b")]);
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();

      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow = makeSurface("messages", [row("a"), row("b"), row("c")], {
        gate,
      });
      store.updateSource("messages", slow.surface.source);
      expect(store.getState().rows).toHaveLength(2);
      store.next(); // local: the old rows are still the rows
      expect(pos(store)).toEqual([1, 0, 1, 2]);
      store.next(); // past the old end: waits (the old scan was done, but a re-scan is running)
      release();
      await flush();
      expect(store.getState().rows).toHaveLength(3);
      expect(pos(store)).toEqual([2, 0, 2, 3]);
    });
  });

  describe("surface registration", () => {
    it("a same-scope re-register (tab switch) puts the user back on their row without revealing it; the next step reveals", async () => {
      const store = new FindStore();
      const all = rows(8);
      const unreg = store.registerSurface(
        makeSurface("messages", all, { live: true }).surface
      );
      store.setTerm("x");
      await flush();
      store.previous();
      await flush();
      expect(activeId(store)).toBe("m7");
      expect(store.claimReveal("m7")).toBe("jumped");
      all.push(row("m8", 1, 8));
      unreg();
      expect(store.getState().rows).toEqual([]);
      const { surface, reveal } = makeSurface("messages", all, { live: true });
      store.registerSurface(surface);
      await flush();
      expect(activeId(store)).toBe("m7");
      expect(pos(store)).toEqual([7, 0, 7, 9]);
      // The list restores its own scroll position; a reveal would fight it.
      expect(reveal).not.toHaveBeenCalled();
      expect(store.claimReveal("m7")).toBeNull();

      store.next();
      expect(activeId(store)).toBe("m8");
      expect(reveal).toHaveBeenCalledTimes(1);
      expect(reveal).toHaveBeenCalledWith(
        row("m8", 1, 8),
        expect.any(AbortSignal)
      );
    });

    it("carries a reveal its row never claimed across a same-scope re-register, for the relocated row to claim", async () => {
      const store = new FindStore();
      const all = rows(8);
      const unreg = store.registerSurface(makeSurface("messages", all).surface);
      store.setTerm("x");
      await flush();
      store.next(); // Enter onto m1 while its row is still paging in...
      expect(activeId(store)).toBe("m1");
      unreg(); // ...then the tab flips before the row mounted
      store.registerSurface(makeSurface("messages", all).surface);
      await flush();
      expect(activeId(store)).toBe("m1");
      expect(store.claimReveal("m1")).toBe("jumped");
      expect(store.claimReveal("m1")).toBeNull();
    });

    it("drops an unclaimed reveal on a re-register under another scope", async () => {
      const store = new FindStore();
      const unreg = store.registerSurface(
        makeSurface("messages", rows(2)).surface
      );
      store.setTerm("x");
      await flush();
      unreg();
      // The other scope has no rows, so nothing overwrites a carried reveal.
      store.registerSurface(makeSurface("other", []).surface);
      await flush();
      expect(store.claimReveal("m0")).toBeNull();
    });

    it("a source swap right after the re-register (the list mounts with a new source identity) keeps the relocation", async () => {
      const store = new FindStore();
      const all = rows(8);
      const unreg = store.registerSurface(makeSurface("messages", all).surface);
      store.setTerm("x");
      await flush();
      store.next();
      store.next();
      expect(activeId(store)).toBe("m2");
      unreg();
      store.registerSurface(makeSurface("messages", all).surface);
      store.updateSource(
        "messages",
        makeSurface("messages", all).surface.source
      );
      await flush();
      expect(activeId(store)).toBe("m2");
      expect(pos(store)).toEqual([2, 0, 2, 8]);
    });

    it("an unregister/register pair before the relocating page lands (React dev double-invokes effects) keeps the place", async () => {
      const store = new FindStore();
      const all = rows(8);
      const unreg = store.registerSurface(makeSurface("messages", all).surface);
      store.setTerm("x");
      await flush();
      store.next();
      store.next();
      unreg();
      const again = store.registerSurface(makeSurface("messages", all).surface);
      again();
      store.registerSurface(makeSurface("messages", all).surface);
      await flush();
      expect(activeId(store)).toBe("m2");
    });

    it("a different scope starts from the first row", async () => {
      const store = new FindStore();
      const all = rows(8);
      const unreg = store.registerSurface(makeSurface("messages", all).surface);
      store.setTerm("x");
      await flush();
      store.previous();
      unreg();
      store.registerSurface(makeSurface("other", all).surface);
      await flush();
      expect(activeId(store)).toBe("m0");
    });

    it("holds one surface: a new registration replaces it, and only the current one unregisters", async () => {
      const store = new FindStore();
      const first = makeSurface("transcript", [row("a")]);
      const second = makeSurface("messages", [row("b")]);
      const unregisterFirst = store.registerSurface(first.surface);
      store.setTerm("x");
      await flush();
      expect(store.getState().scopeId).toBe("transcript");

      store.registerSurface(second.surface);
      await flush();
      expect(store.getState().scopeId).toBe("messages");
      expect(store.getState().rows).toEqual([row("b")]);

      unregisterFirst();
      expect(store.getState().scopeId).toBe("messages");
      expect(store.getState().term).toBe("x");
    });
  });

  describe("claimReveal", () => {
    it("hands out each activation's reveal once, to the active row only", async () => {
      const store = new FindStore();
      const all = [row("a"), row("b")];
      const { surface } = makeSurface("messages", all, { live: true });
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      expect(store.claimReveal("b")).toBeNull();
      expect(store.claimReveal("a")).toBe("jumped");
      expect(store.claimReveal("a")).toBeNull();

      // A live re-scan that keeps the row requests no reveal.
      all.unshift(row("z"));
      store.invalidate("messages");
      await flush();
      expect(activeId(store)).toBe("a");
      expect(store.claimReveal("a")).toBeNull();

      store.next();
      expect(activeId(store)).toBe("b");
      expect(store.claimReveal("a")).toBeNull();
      expect(store.claimReveal("b")).toBe("jumped");
      expect(store.claimReveal("b")).toBeNull();
    });

    it("tells a row mounted at activation from one the list had to bring in", async () => {
      const store = new FindStore();
      const { surface } = makeSurface("messages", [row("a"), row("b", 2)]);
      store.registerSurface(surface);
      const detach = store.attachRow("b");
      store.setTerm("x");
      await flush();
      expect(store.claimReveal("a")).toBe("jumped");
      store.next();
      expect(store.claimReveal("b")).toBe("mounted");
      store.next(); // a step inside the mounted row
      expect(store.claimReveal("b")).toBe("mounted");
      detach();
      store.previous();
      expect(store.claimReveal("b")).toBe("jumped");
    });

    it("drops an unclaimed reveal on a new term and on close; a re-register does not re-issue a claimed one", async () => {
      const store = new FindStore();
      // "x" first hits a, "y" first hits b: x's reveal must be gone before
      // y's page lands, not merely overwritten by it.
      const surface: FindSurface = {
        scopeId: "messages",
        source: {
          find: (query) =>
            Promise.resolve({
              rows: [query.text === "x" ? row("a") : row("b")],
              atEnd: true,
              complete: true,
            }),
        },
        reveal: () => {},
      };
      const unreg = store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.setTerm("y");
      expect(store.claimReveal("a")).toBeNull();
      await flush();
      expect(store.claimReveal("b")).toBe("jumped");

      store.next();
      store.close();
      expect(store.claimReveal("b")).toBeNull();

      store.setTerm("x");
      await flush();
      expect(store.claimReveal("a")).toBe("jumped");
      unreg();
      store.registerSurface(surface);
      await flush();
      expect(activeId(store)).toBe("a");
      expect(store.claimReveal("a")).toBeNull();
    });
  });

  it("clears state on close and empty term", async () => {
    const store = new FindStore();
    const { surface } = makeSurface("messages", [row("a")]);
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();
    store.attachRow("a");
    store.reportRowCount("a", 2);
    store.next();
    expect(pos(store)).toEqual([0, 1, 0, 1]);

    store.close();
    expect(store.getState()).toMatchObject({
      term: "",
      rows: [],
      activeRow: null,
      count: null,
      scopeId: "messages",
    });

    store.setTerm("x");
    await flush();
    expect(pos(store)).toEqual([0, 0, 0, 1]);
    store.setTerm("");
    expect(store.getState().rows).toEqual([]);
  });

  describe("a page that fails", () => {
    it("on the first page leaves an empty state carrying the error (no count, no 'No results') and drops waiting steps", async () => {
      const store = new FindStore();
      const surface: FindSurface = {
        scopeId: "messages",
        source: { find: () => Promise.reject(new Error("boom")) },
        reveal: () => {},
      };
      store.registerSurface(surface);
      store.setTerm("x");
      store.next();
      await flush();
      expect(store.getState()).toMatchObject({
        rows: [],
        activeRow: null,
        count: null,
        noResults: false,
        error: "boom",
      });

      // The error stays until the next search.
      store.next();
      expect(store.getState().error).toBe("boom");
      const good = makeSurface("messages", [row("a")]);
      store.updateSource("messages", good.surface.source);
      expect(store.getState().error).toBeNull();
      await flush();
      expect(pos(store)).toEqual([0, 0, 0, 1]);
    });

    it("after some pages keeps what was found as a lower bound", async () => {
      const store = new FindStore();
      let n = 0;
      const surface: FindSurface = {
        scopeId: "messages",
        source: {
          find: (): Promise<FindPage> =>
            n++ === 0
              ? Promise.resolve({
                  rows: [row("a"), row("b")],
                  atEnd: false,
                  complete: true,
                })
              : Promise.reject(new Error("boom")),
        },
        reveal: () => {},
      };
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      expect(store.getState()).toMatchObject({
        count: 2,
        exact: false,
        error: "boom",
      });
      store.next();
      store.next(); // wraps: the scan is over
      expect(pos(store)).toEqual([0, 0, 0, 2]);
      store.setTerm("y");
      expect(store.getState().error).toBeNull();
    });
  });

  describe("DOM counts", () => {
    it("forgets a row's count when its highlight detaches", async () => {
      const store = new FindStore();
      const { surface } = makeSurface("messages", [
        row("a"),
        row("b", 2),
        row("c"),
      ]);
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      const detach = store.attachRow("b");
      store.reportRowCount("b", 0);
      store.next();
      expect(pos(store)[0]).toBe(2);
      detach();
      store.previous();
      expect(pos(store)).toEqual([1, 1, 2, 4]);
    });

    it("clamps the active occurrence to the source count when the row detaches with extra DOM matches", async () => {
      const store = new FindStore();
      const { surface } = makeSurface("messages", [row("a", 2), row("b")]);
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      const detach = store.attachRow("a");
      store.reportRowCount("a", 5);
      store.next();
      store.next();
      store.next();
      store.next();
      expect(pos(store)).toEqual([0, 4, 1, 3]);
      detach();
      expect(pos(store)).toEqual([0, 1, 1, 3]);
      store.previous();
      expect(pos(store)).toEqual([0, 0, 0, 3]);
    });

    it("forgets a row's count while its markdown is pending, stepping by the source count meanwhile", async () => {
      const store = new FindStore();
      const { surface } = makeSurface("messages", [row("a", 3), row("b")]);
      store.registerSurface(surface);
      store.setTerm("x");
      await flush();
      store.attachRow("a");
      store.reportRowCount("a", 1);
      store.reportRowCount("a", null);
      store.next();
      expect(pos(store)).toEqual([0, 1, 1, 4]);
      store.reportRowCount("a", 1);
      expect(pos(store)).toEqual([0, 0, 0, 4]);
    });
  });
});
