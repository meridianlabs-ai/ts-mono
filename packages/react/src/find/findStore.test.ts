import { describe, expect, it, vi } from "vitest";

import { FIND_STEP_LIMIT, FindStore } from "./findStore";
import type {
  FindMatch,
  FindOptions,
  FindQuery,
  FindSource,
  FindStreamItem,
  FindSurface,
} from "./types";

const match = (id: string, occurrence = 0): FindMatch => ({
  anchor: { kind: "event", id },
  occurrence,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface FakeSurfaceOptions {
  /** Matches yielded per stream chunk (default: all at once). */
  chunk?: number;
  /** Force a "gte" total capped at the limit (simulates a capped scan). */
  capped?: boolean;
  /** Delay each chunk until this promise resolves (for abort tests). */
  gate?: Promise<void>;
}

function makeSurface(
  scopeId: string,
  all: FindMatch[],
  options: FakeSurfaceOptions = {}
): {
  surface: FindSurface;
  reveal: ReturnType<typeof vi.fn>;
  calls: FindOptions[];
} {
  const calls: FindOptions[] = [];
  const source: FindSource = {
    scopeId,
    capabilities: { complete: true },
    // Same cursor/paging semantics the default in-memory source implements.
    async *find(
      _query: FindQuery,
      opts: FindOptions,
      signal: AbortSignal
    ): AsyncIterable<FindStreamItem> {
      calls.push(opts);
      if (options.gate) await options.gate;
      const backward = opts.direction === "backward";
      const limit = opts.limit ?? Number.POSITIVE_INFINITY;
      let start: number;
      if (opts.cursor) {
        const cursor = opts.cursor;
        const at = all.findIndex(
          (m) =>
            m.anchor.id === cursor.anchor.id &&
            m.occurrence === cursor.occurrence
        );
        start = backward ? at - 1 : at + 1;
      } else {
        start = backward ? all.length - 1 : 0;
      }
      const page: FindMatch[] = [];
      for (
        let i = start;
        i >= 0 && i < all.length && page.length < limit;
        i += backward ? -1 : 1
      ) {
        page.push(all[i]!);
      }
      const chunk = options.chunk ?? page.length;
      for (let i = 0; i < page.length; i += chunk) {
        if (signal.aborted) return;
        yield { kind: "matches", matches: page.slice(i, i + chunk) };
      }
      if (signal.aborted) return;
      yield {
        kind: "end",
        complete: true,
        total: options.capped
          ? { value: page.length, relation: "gte" }
          : { value: all.length, relation: "eq" },
      };
    },
  };
  const reveal = vi.fn(() => Promise.resolve<"revealed">("revealed"));
  return { surface: { scopeId, source, reveal }, reveal, calls };
}

describe("FindStore", () => {
  it("surveys on term change: fills the window, totals, reveals the first match", async () => {
    const store = new FindStore();
    const { surface, reveal } = makeSurface("transcript", [
      match("a"),
      match("b"),
      match("c"),
    ]);
    store.registerSurface(surface);

    store.setTerm("x");
    await flush();

    const st = store.getState();
    expect(st.matches).toHaveLength(3);
    expect(st.activeIndex).toBe(0);
    expect(st.total).toEqual({ value: 3, relation: "eq" });
    expect(st.complete).toBe(true);
    expect(st.searching).toBe(false);
    expect(st.noResults).toBe(false);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal.mock.calls[0]?.[0]).toEqual(match("a"));
  });

  it("reports noResults when the survey finds nothing", async () => {
    const store = new FindStore();
    const { surface, reveal } = makeSurface("transcript", []);
    store.registerSurface(surface);

    store.setTerm("x");
    await flush();

    expect(store.getState().noResults).toBe(true);
    expect(store.getState().total).toEqual({ value: 0, relation: "eq" });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("steps forward and backward with wrap-around inside a complete window", async () => {
    const store = new FindStore();
    const { surface, reveal } = makeSurface("transcript", [
      match("a"),
      match("b"),
      match("c"),
    ]);
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();

    store.next();
    expect(store.getState().activeIndex).toBe(1);
    store.next();
    expect(store.getState().activeIndex).toBe(2);
    store.next(); // wrap
    expect(store.getState().activeIndex).toBe(0);
    store.previous(); // wrap back
    expect(store.getState().activeIndex).toBe(2);
    expect(store.getState().lastDirection).toBe("backward");
    // initial reveal + 4 steps
    expect(reveal).toHaveBeenCalledTimes(5);
  });

  it("keeps a 'gte' total from a capped source (renders as M+)", async () => {
    const store = new FindStore();
    const all = Array.from({ length: 10 }, (_, i) => match(`m${i}`));
    const { surface } = makeSurface("transcript", all, { capped: true });
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();

    expect(store.getState().total).toEqual({ value: 10, relation: "gte" });
  });

  it("extends the window with a cursor call when stepping past its end", async () => {
    const store = new FindStore();
    // More matches than the survey limit would matter for; simulate a small
    // window by intercepting: survey yields everything here, so instead use
    // a capped source whose survey returns only the first 3.
    const all = Array.from({ length: 6 }, (_, i) => match(`m${i}`));
    const { surface, calls } = makeSurface("transcript", all);
    // Constrain the survey to a 3-match window via a wrapper source.
    const windowed: FindSurface = {
      ...surface,
      source: {
        ...surface.source,
        find: (query, opts, signal) =>
          surface.source.find(
            query,
            { ...opts, limit: Math.min(opts.limit ?? 3, 3) },
            signal
          ),
      },
    };
    store.registerSurface(windowed);
    store.setTerm("x");
    await flush();
    expect(store.getState().matches).toHaveLength(3);

    store.next();
    store.next();
    expect(store.getState().activeIndex).toBe(2);
    store.next(); // past window end → cursor call
    await flush();

    const st = store.getState();
    expect(st.matches.length).toBeGreaterThan(3);
    expect(st.activeIndex).toBe(3);
    expect(st.matches[3]).toEqual(match("m3"));
    const cursorCall = calls.find((c) => c.cursor !== undefined);
    expect(cursorCall?.cursor?.anchor.id).toBe("m2");
    expect(cursorCall?.direction).toBe("forward");
  });

  it("wraps backward past an incomplete window via a backward no-cursor call", async () => {
    const store = new FindStore();
    const all = Array.from({ length: 6 }, (_, i) => match(`m${i}`));
    const { surface, calls } = makeSurface("transcript", all);
    const windowed: FindSurface = {
      ...surface,
      source: {
        ...surface.source,
        find: (query, opts, signal) =>
          surface.source.find(
            query,
            { ...opts, limit: Math.min(opts.limit ?? 3, 3) },
            signal
          ),
      },
    };
    store.registerSurface(windowed);
    store.setTerm("x");
    await flush();
    expect(store.getState().activeIndex).toBe(0);

    store.previous(); // wrap from start of an incomplete window → suffix fetch
    await flush();

    const st = store.getState();
    expect(st.activeIndex).toBe(st.matches.length - 1);
    expect(st.matches[st.activeIndex!]).toEqual(match("m5"));
    const backwardCall = calls.find((c) => c.direction === "backward");
    expect(backwardCall).toBeDefined();
    expect(backwardCall?.cursor).toBeUndefined();
  });

  it("aborts the in-flight query when the term changes", async () => {
    const store = new FindStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = makeSurface("transcript", [match("slow")], { gate });
    const fast = makeSurface("transcript", [match("fast")]);
    const combined: FindSurface = {
      scopeId: "transcript",
      source: {
        scopeId: "transcript",
        capabilities: { complete: true },
        find: (query, opts, signal) =>
          query.text === "slowterm"
            ? slow.surface.source.find(query, opts, signal)
            : fast.surface.source.find(query, opts, signal),
      },
      reveal: (m, s) => fast.surface.reveal(m, s),
    };
    store.registerSurface(combined);

    store.setTerm("slowterm");
    store.setTerm("fastterm");
    await flush();
    release();
    await flush();

    // Only the fast query's results are in the window; the aborted slow
    // stream contributed nothing.
    expect(store.getState().matches).toEqual([match("fast")]);
    expect(store.getState().term).toBe("fastterm");
  });

  it("re-surveys without revealing when the surface re-registers (data change)", async () => {
    const store = new FindStore();
    const first = makeSurface("transcript", [match("a"), match("b")]);
    const un = store.registerSurface(first.surface);
    store.setTerm("x");
    await flush();
    store.next();
    expect(store.getState().activeIndex).toBe(1);
    expect(first.reveal).toHaveBeenCalledTimes(2);

    // Data changed: same scope re-registers with more matches.
    const second = makeSurface("transcript", [
      match("a"),
      match("a", 1),
      match("b"),
    ]);
    un();
    store.registerSurface(second.surface);
    await flush();

    const st = store.getState();
    expect(st.matches).toHaveLength(3);
    // Previous active match ("b") relocated in the new window, no reveal.
    expect(st.activeIndex).toBe(2);
    expect(second.reveal).not.toHaveBeenCalled();
  });

  it("clears state on close and empty term", async () => {
    const store = new FindStore();
    const { surface } = makeSurface("transcript", [match("a")]);
    store.registerSurface(surface);
    store.setTerm("x");
    await flush();
    expect(store.getState().matches).toHaveLength(1);

    store.close();
    expect(store.getState().term).toBe("");
    expect(store.getState().matches).toHaveLength(0);
    expect(store.getState().scopeId).toBe("transcript");
  });

  it("prefers the most recently registered surface and falls back on unregister", async () => {
    const store = new FindStore();
    const a = makeSurface("transcript", [match("a")]);
    const b = makeSurface("messages", [match("m")]);
    store.registerSurface(a.surface);
    const unB = store.registerSurface(b.surface);
    expect(store.getState().scopeId).toBe("messages");

    store.setTerm("x");
    await flush();
    expect(store.getState().matches).toEqual([match("m")]);

    unB();
    await flush();
    expect(store.getState().scopeId).toBe("transcript");
    expect(store.getState().matches).toEqual([match("a")]);
  });

  it("steps through streamed matches before the survey ends", async () => {
    const store = new FindStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const all = Array.from({ length: 4 }, (_, i) => match(`m${i}`));
    // First chunk arrives immediately; the source then stalls before its end.
    const source: FindSource = {
      scopeId: "transcript",
      capabilities: { complete: true },
      async *find() {
        yield {
          kind: "matches",
          matches: all.slice(0, 2),
        } satisfies FindStreamItem;
        await gate;
        yield {
          kind: "matches",
          matches: all.slice(2),
        } satisfies FindStreamItem;
        yield {
          kind: "end",
          complete: true,
          total: { value: 4, relation: "eq" },
        } satisfies FindStreamItem;
      },
    };
    const reveal = vi.fn(() => Promise.resolve<"revealed">("revealed"));
    store.registerSurface({ scopeId: "transcript", source, reveal });
    store.setTerm("x");
    await flush();

    expect(store.getState().searching).toBe(true);
    expect(store.getState().matches).toHaveLength(2);
    // Enter steps through what's known immediately.
    store.next();
    expect(store.getState().activeIndex).toBe(1);

    release();
    await flush();
    expect(store.getState().searching).toBe(false);
    expect(store.getState().matches).toHaveLength(4);
    // The step landed on index 1 and stays there.
    expect(store.getState().activeIndex).toBe(1);
  });
});

it("FIND_STEP_LIMIT stays below the survey window", () => {
  expect(FIND_STEP_LIMIT).toBeLessThan(2000);
});
