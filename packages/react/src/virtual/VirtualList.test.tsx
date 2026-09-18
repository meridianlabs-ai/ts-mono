// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import { createRef, type ReactNode, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtendedFindProvider } from "../components/ExtendedFindContext";
import { useMountEffect } from "../hooks/useMountEffect";
import {
  ComponentStateHooks,
  ComponentStateProvider,
} from "../state/ComponentStateContext";
import {
  makeReactiveStateHooks,
  makeReactiveStateStore,
  makeStateHooks,
} from "../test/component-state-hooks";

import type { VirtualListHandle } from "./types";
import { useVirtualListState } from "./use-virtual-list-state";
import { VirtualList } from "./VirtualList";
import { useVirtualScroller } from "./VirtualScrollerContext";

const Wrapper: React.FC<{
  hooks: ComponentStateHooks;
  children: ReactNode;
}> = ({ hooks, children }) => (
  <ComponentStateProvider hooks={hooks}>
    <ExtendedFindProvider>{children}</ExtendedFindProvider>
  </ComponentStateProvider>
);

// jsdom has no scrollTo; VirtualList calls it during mount/follow.
beforeEach(() => {
  Element.prototype.scrollTo = function () {};
});

describe("VirtualList live-finish scroll-to-top", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const mountList = (
    scrollRef: RefObject<HTMLDivElement | null>,
    makeHooks: () => ComponentStateHooks = makeStateHooks
  ) => {
    const props = {
      persistenceKey: "test-list",
      scrollRef,
      data: ["a", "b", "c"],
      renderRow: (_index: number, item: string) => <div>{item}</div>,
      scrollToTopOnFinish: true,
    };
    const hooks = makeHooks();
    const view = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string> {...props} live={true} />
        </div>
      </Wrapper>
    );
    const rerenderLive = (live: boolean) =>
      view.rerender(
        <Wrapper hooks={hooks}>
          <div ref={scrollRef}>
            <VirtualList<string> {...props} live={live} />
          </div>
        </Wrapper>
      );
    return { ...view, rerenderLive };
  };

  it("scrolls to top when a live list finishes", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const { rerenderLive, unmount } = mountList(scrollRef);

    rerenderLive(false);
    // Spy only on what fires after the flip — the finish timer.
    const scrollTo = vi.fn();
    scrollRef.current!.scrollTo = scrollTo;
    vi.advanceTimersByTime(200);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    unmount();
  });

  it("scrolls to top on finish with a reactive store (production-like)", () => {
    // In production, followOutput lives in a zustand store: the finish
    // effect's own setFollowOutput(false) re-renders the component, changes
    // the effect's followOutput dependency, and re-runs the effect. The
    // cleanup must not cancel the just-scheduled finish timer in that
    // self-inflicted re-run — only user interaction or unmount may cancel it.
    const scrollRef = createRef<HTMLDivElement>();
    const { rerenderLive, unmount } = mountList(
      scrollRef,
      makeReactiveStateHooks
    );

    rerenderLive(false);
    const scrollTo = vi.fn();
    scrollRef.current!.scrollTo = scrollTo;
    vi.advanceTimersByTime(200);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    unmount();
  });

  it("does not scroll the (shared) container after unmount", () => {
    // The finish timer captures the scroll element; the container outlives the
    // list (shared sample scroller), so an uncancelled timer would scroll
    // whatever view owns the container next.
    const scrollRef = createRef<HTMLDivElement>();
    const { rerenderLive, unmount } = mountList(scrollRef);

    rerenderLive(false);
    const scrollTo = vi.fn();
    scrollRef.current!.scrollTo = scrollTo;
    unmount();
    vi.advanceTimersByTime(200);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not scroll to top if the user scrolls away (disengaging follow) within the 100ms finish window", () => {
    // The finish effect schedules a 100ms scrollTo(top:0) timer. If the
    // user scrolls away within that window, followOutput flips to false and
    // the effect re-runs, but its re-run only checks the *current* condition
    // — it never cancels the timer scheduled by the *previous* run. The stale
    // timer fires anyway, yanking the view back to the top against the user's
    // explicit scroll.
    const scrollRef = createRef<HTMLDivElement>();
    // Reactive store, like production — a non-reactive fake would skip the
    // followOutput-flip re-render this scenario hinges on.
    const { rerenderLive, unmount } = mountList(
      scrollRef,
      makeReactiveStateHooks
    );
    const el = scrollRef.current!;

    Object.defineProperty(el, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(el, "clientHeight", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(el, "scrollTop", {
      value: 700,
      configurable: true,
      writable: true,
    });

    rerenderLive(false); // schedules the 100ms top-scroll (followOutput was true)

    const scrollTo = vi.fn();
    el.scrollTo = scrollTo;

    // User scrolls up within the window: a wheel event marks real user
    // interaction, then a scroll event (rAF-throttled) reports "not at
    // bottom" and flips followOutput false.
    el.scrollTop = 200;
    el.dispatchEvent(new Event("wheel"));
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20); // let the rAF-throttled handler run

    vi.advanceTimersByTime(100); // reach the original 100ms mark
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    unmount();
  });
});

describe("VirtualList follow arming (nav ownership)", () => {
  // A reactive store whose backing Map the test can read, so we can assert the
  // effective initial follow VirtualList writes through as the single source of
  // truth (the `<id>::follow` key).
  const mountFollow = (
    props: Partial<React.ComponentProps<typeof VirtualList<string>>>,
    seedFollow?: boolean
  ) => {
    const { hooks, store } = makeReactiveStateStore();
    if (seedFollow !== undefined) store.set("follow-list::follow", seedFollow);
    const scrollRef = createRef<HTMLDivElement>();
    const view = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            persistenceKey="follow-list"
            scrollRef={scrollRef}
            data={["a", "b", "c"]}
            renderRow={(_i, item) => <div>{item}</div>}
            {...props}
          />
        </div>
      </Wrapper>
    );
    const follow = () => store.get("follow-list::follow");
    return { ...view, follow };
  };

  it("fresh live mount tails from the start (main's behavior)", () => {
    // No deep link, no persisted state: a live sample follows the tail.
    const { follow, unmount } = mountFollow({ live: true });
    expect(follow()).toBe(true);
    unmount();
  });

  it("static mount does not follow", () => {
    const { follow, unmount } = mountFollow({ live: false });
    expect(follow()).toBe(false);
    unmount();
  });

  it("nav-owned mount stands down despite live (S1: ?event= deep link)", () => {
    // A deep-link landing owns the position: follow must NOT auto-arm from live.
    const { follow, unmount } = mountFollow({
      live: true,
      navOwned: true,
      initialIndex: 1,
    });
    expect(follow()).toBe(false);
    unmount();
  });

  it("nav-owned mount overrides a persisted follow=true (S2: exit-focus landing)", () => {
    // The store carried a true from an earlier tail; the nav-owned remount must
    // reset it so the deep-link landing wins instead of yanking to the tail.
    const { follow, unmount } = mountFollow(
      { live: true, navOwned: true, initialIndex: 1 },
      true
    );
    expect(follow()).toBe(false);
    unmount();
  });

  it("followRequested arms even on a nav-owned mount (explicit follow=1)", () => {
    const { follow, unmount } = mountFollow({
      live: true,
      navOwned: true,
      followRequested: true,
      initialIndex: 1,
    });
    expect(follow()).toBe(true);
    unmount();
  });

  it("non-nav remount honors a persisted follow=true", () => {
    // Plain remount (no deep link): the persisted tail state survives.
    const { follow, unmount } = mountFollow({ live: true }, true);
    expect(follow()).toBe(true);
    unmount();
  });

  // Re-render the same list with a changing `live` so we can drive the
  // false→true flip a late-loading stream produces (data arrives after the
  // first render, so the sample only becomes live on a later commit).
  const mountFlippable = (initialLive: boolean, seedFollow?: boolean) => {
    const { hooks, store } = makeReactiveStateStore();
    if (seedFollow !== undefined) store.set("follow-list::follow", seedFollow);
    const scrollRef = createRef<HTMLDivElement>();
    const props = {
      persistenceKey: "follow-list",
      scrollRef,
      data: ["a", "b", "c"],
      renderRow: (_i: number, item: string) => <div>{item}</div>,
    };
    const view = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string> {...props} live={initialLive} />
        </div>
      </Wrapper>
    );
    const setLive = (live: boolean) =>
      view.rerender(
        <Wrapper hooks={hooks}>
          <div ref={scrollRef}>
            <VirtualList<string> {...props} live={live} />
          </div>
        </Wrapper>
      );
    const follow = () => store.get("follow-list::follow");
    return { ...view, follow, setLive };
  };

  it("re-arms follow when live flips true after the first render (late-loading stream)", () => {
    // Fresh mount, no persisted state, data not yet streaming: not following.
    const { follow, setLive, unmount } = mountFlippable(false);
    expect(follow()).toBe(false);
    // The sample starts streaming — the tail must arm from the start, exactly
    // as a mount that was live from the first render would.
    setLive(true);
    expect(follow()).toBe(true);
    unmount();
  });

  it("does NOT re-arm on a live flip when follow was explicitly disarmed", () => {
    // A persisted false is a real user choice, not the seed's provisional
    // write, so a later live flip must leave it alone.
    const { follow, setLive, unmount } = mountFlippable(false, false);
    expect(follow()).toBe(false);
    setLive(true);
    expect(follow()).toBe(false);
    unmount();
  });
});

describe("VirtualList persist flush on unmount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const mountWithStore = (
    scrollRef: RefObject<HTMLDivElement | null>,
    seed?: Record<string, unknown>
  ) => {
    const store = new Map<string, unknown>(Object.entries(seed ?? {}));
    const getKey = (id: string, prop: string) => `${id}::${prop}`;
    const hooks: ComponentStateHooks = {
      useValue: (id, prop, defaultValue) =>
        store.has(getKey(id, prop))
          ? store.get(getKey(id, prop))
          : defaultValue,
      useSetValue: () => (id, prop, value) => {
        store.set(getKey(id, prop), value);
      },
      useRemoveValue: () => (id, prop) => {
        store.delete(getKey(id, prop));
      },
      useEntries: () => undefined,
      useRemoveAll: () => () => {},
      useRemoveByPrefix: () => () => {},
    };
    const view = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            persistenceKey="flush-list"
            scrollRef={scrollRef}
            data={["a", "b", "c"]}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
          />
        </div>
      </Wrapper>
    );
    return { ...view, store };
  };

  it("keeps a handle jump issued before the mount-time positioning (the reset to top does not undo it)", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const hooks: ComponentStateHooks = {
      useValue: (_id, _prop, defaultValue) => defaultValue,
      useSetValue: () => () => {},
      useRemoveValue: () => () => {},
      useEntries: () => undefined,
      useRemoveAll: () => () => {},
      useRemoveByPrefix: () => () => {},
    };
    render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            ref={handle}
            persistenceKey="early-jump"
            scrollRef={scrollRef}
            data={Array.from({ length: 20 }, (_, i) => `row ${i}`)}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    Object.defineProperty(el, "scrollTop", {
      value: 0,
      configurable: true,
      writable: true,
    });
    // jsdom has no layout: give the scroller room so the jump is not clamped.
    Object.defineProperty(el, "scrollHeight", {
      value: 8000,
      configurable: true,
    });
    Object.defineProperty(el, "clientHeight", {
      value: 600,
      configurable: true,
    });
    el.scrollTo = function (options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) {
        el.scrollTop = options.top;
      }
    };
    // A find reveal answered from cache lands before the mount effect's frame.
    handle.current!.scrollToIndex({ index: 10, align: "start" });
    expect(el.scrollTop).toBeGreaterThan(0);
    const jumped = el.scrollTop;
    vi.advanceTimersByTime(50);
    expect(el.scrollTop).toBe(jumped);
  });

  it("flushes a pending debounced save with the position captured at scroll time", () => {
    // A tab flip inside the persist debounce must not lose the position
    // (cancelling the timer restores nothing on flip-back), and the flush
    // must use the snapshot captured while this list still owned the shared
    // container — at unmount time the container can already show the next
    // tab's content (e.g. clamped to 0).
    const scrollRef = createRef<HTMLDivElement>();
    const { store, unmount } = mountWithStore(scrollRef);
    const el = scrollRef.current!;
    vi.advanceTimersByTime(50); // let the mount-time initial scroll settle

    Object.defineProperty(el, "scrollTop", {
      value: 500,
      configurable: true,
      writable: true,
    });
    el.dispatchEvent(new Event("wheel"));
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20); // rAF-throttled capture runs

    // The shared container is swapped/clamped before the debounce elapses.
    el.scrollTop = 0;
    unmount();

    // Rows are estimate-sized (400px): 500 lands 100px into row 1.
    expect(store.get("flush-list::snapshot")).toMatchObject({
      version: 2,
      index: 1,
      offsetInRow: 100,
    });

    // And nothing fires later against the departed container.
    store.delete("flush-list::snapshot");
    vi.advanceTimersByTime(1000);
    expect(store.get("flush-list::snapshot")).toBeUndefined();
  });

  it("ignores the shared container's clamp once its rows have left the DOM", () => {
    // The next tab's shorter content replaces the rows in the commit; the
    // container clamps and fires a scroll event before React detaches this
    // list's listener. That event is not the user's position.
    const scrollRef = createRef<HTMLDivElement>();
    const { store, unmount } = mountWithStore(scrollRef);
    const el = scrollRef.current!;
    vi.advanceTimersByTime(50);

    Object.defineProperty(el, "scrollTop", {
      value: 900,
      configurable: true,
      writable: true,
    });
    el.dispatchEvent(new Event("wheel"));
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    el.firstElementChild!.remove();
    el.scrollTop = 300;
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    // Rows are estimate-sized (400px): 900 is 100px into row 2. Neither the
    // debounce timer (which must not re-read the clamped container)...
    vi.advanceTimersByTime(300);
    expect(store.get("flush-list::snapshot")).toMatchObject({
      index: 2,
      offsetInRow: 100,
    });
    // ...nor the unmount flush may replace it.
    unmount();
    expect(store.get("flush-list::snapshot")).toMatchObject({
      index: 2,
      offsetInRow: 100,
    });
  });

  it("restores a persisted anchor to the saved offset within its row", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    mountWithStore(scrollRef, {
      "flush-list::snapshot": {
        version: 2,
        index: 2,
        offsetInRow: 50,
        totalCount: 3,
      },
    });
    // jsdom reports scrollHeight 0, which the virtualizer clamps targets to.
    const el = scrollRef.current!;
    Object.defineProperty(el, "scrollHeight", { value: 1200 });
    vi.advanceTimersByTime(50);
    // Row 2 of three 400px estimates starts at 800: one write, no hop via
    // the row start.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 850, behavior: "auto" });
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 800, behavior: "auto" });
    const writes = scrollTo.mock.calls.length;
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scrollend"));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(scrollTo.mock.calls.length).toBe(writes);
  });

  it("jumps to the anchor row first when the saved offset is past its estimate", () => {
    // The shared container came back holding another view's scrollTop, so the
    // mount band rendered rows far from the anchor and the anchor is still
    // estimate-sized. An in-row offset larger than that estimate is a
    // position estimate space cannot express: added to the row start it
    // lands rows below. Jump by index (re-aimed as rows measure) instead.
    const scrollRef = createRef<HTMLDivElement>();
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    const { hooks, store } = makeReactiveStateStore();
    store.set("estimate-list::snapshot", {
      version: 2,
      index: 24,
      offsetInRow: 2449,
      totalCount: 100,
    });
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            persistenceKey="estimate-list"
            scrollRef={scrollRef}
            data={Array.from({ length: 100 }, (_, i) => `row ${i}`)}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    // Tall enough that the target is not clamped: the old code took the
    // one-write path on this.
    Object.defineProperty(el, "scrollHeight", { value: 40000 });
    Object.defineProperty(el, "clientHeight", { value: 600 });
    vi.advanceTimersByTime(50);
    // Row 24 of 400px estimates starts at 9600; the estimate-space target
    // 12049 is inside row 30.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 9600, behavior: "auto" });
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 12049, behavior: "auto" });
    unmount();
  });

  it("keeps the landing anchored when rows above it measure before the jump's scroll event", async () => {
    // Rows the top band mounted before the restore write are measured in a
    // microtask after it; the virtualizer only learns the new offset from the
    // scroll event, so their shrink must still count as "above the viewport"
    // and shift scrollTop from where the write landed, not from 0.
    const scrollRef = createRef<HTMLDivElement>();
    Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) {
        Object.defineProperty(this, "scrollTop", {
          value: options.top,
          configurable: true,
          writable: true,
        });
      }
    };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.hasAttribute("data-scroller"))
          return new DOMRect(0, 0, 800, 600);
        return new DOMRect();
      }
    );
    // Rows measure 600px (the estimate is 400).
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    const { hooks, store } = makeReactiveStateStore();
    store.set("anchored-list::snapshot", {
      version: 2,
      index: 15,
      offsetInRow: 0,
      totalCount: 20,
    });
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef} data-scroller="">
          <VirtualList<string>
            persistenceKey="anchored-list"
            scrollRef={scrollRef}
            data={Array.from({ length: 20 }, (_, i) => `row ${i}`)}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    Object.defineProperty(el, "scrollHeight", { value: 20000 });
    Object.defineProperty(el, "clientHeight", { value: 600 });
    // The restore lands on the estimates while the mount band's measurement
    // is still queued.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(el.scrollTop).toBe(6000);
    await act(async () => {});
    // Row 15's start in the list's own layout: the spacer above the rendered
    // band plus the row's offset in it.
    const list = el.firstElementChild!;
    const band = [...list.children].find(
      (child) =>
        child instanceof HTMLElement && child.style.position === "relative"
    )!;
    const spacer = [...list.children]
      .slice(0, [...list.children].indexOf(band))
      .reduce(
        (sum, chunk) =>
          sum +
          (chunk instanceof HTMLElement ? parseFloat(chunk.style.height) : 0),
        0
      );
    const row = band.querySelector<HTMLElement>('[data-index="15"]')!;
    expect(el.scrollTop).toBeGreaterThan(6000);
    expect(el.scrollTop).toBe(spacer + parseFloat(row.style.top));
    unmount();
    vi.restoreAllMocks();
  });

  it("jumps to the anchor row first when the scroller is still too short for the target", () => {
    // Rows below the anchor are estimate-sized on remount, so the scroller
    // can be shorter than the saved position; an offset write would clamp to
    // the current max (a later row) with nothing re-aiming it.
    const scrollRef = createRef<HTMLDivElement>();
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    const { hooks, store } = makeReactiveStateStore();
    store.set("short-list::snapshot", {
      version: 2,
      index: 9,
      offsetInRow: 300,
      totalCount: 10,
    });
    const data = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            persistenceKey="short-list"
            scrollRef={scrollRef}
            data={data}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    // Row 9 starts at 3600; the target 3900 exceeds the 3700 scroller.
    Object.defineProperty(el, "scrollHeight", {
      value: 3700,
      configurable: true,
    });
    // One frame: the mount-time jump fires, its guard release is still pending.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 3600, behavior: "auto" });
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 3700, behavior: "auto" });

    // The jump's scroll event; its landing renders and measures the tail
    // rows, so the scroller has grown by the time scrollend arrives.
    el.dispatchEvent(new Event("scroll"));
    Object.defineProperty(el, "scrollHeight", { value: 5000 });
    el.dispatchEvent(new Event("scrollend"));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 3900, behavior: "auto" });
    unmount();
  });

  it("restores without the jump padding: the saved position is where the user was", () => {
    // scrollPaddingStart clears sticky chrome on jumps; a restore must land
    // on the persisted viewport top, not 15px above the row.
    const scrollRef = createRef<HTMLDivElement>();
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    const { hooks, store } = makeReactiveStateStore();
    store.set("padded-list::snapshot", {
      version: 2,
      index: 1,
      offsetInRow: 0,
      totalCount: 3,
    });
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            persistenceKey="padded-list"
            scrollRef={scrollRef}
            data={["a", "b", "c"]}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
            scrollPaddingStart={15}
          />
        </div>
      </Wrapper>
    );
    Object.defineProperty(scrollRef.current!, "scrollHeight", { value: 1200 });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: "auto" });
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 385, behavior: "auto" });
    unmount();
  });

  it("ignores a version-1 (raw offset) snapshot", () => {
    const restore = (seed: unknown) => {
      const { hooks, store } = makeReactiveStateStore();
      store.set("v1-list::snapshot", seed);
      const wrapper: React.FC<{ children: ReactNode }> = ({ children }) => (
        <Wrapper hooks={hooks}>{children}</Wrapper>
      );
      const { result } = renderHook(() => useVirtualListState("v1-list"), {
        wrapper,
      });
      return result.current.getRestoreSnapshot();
    };
    expect(
      restore({ version: 1, scrollOffset: 500, totalCount: 3 })
    ).toBeUndefined();
    const v2 = { version: 2, index: 2, offsetInRow: 0, totalCount: 3 };
    expect(restore(v2)).toEqual(v2);
  });

  it("persists the landing a row requests through the scroller context", () => {
    // A find hit centred by its row is where the user now is; a snapshot
    // left at the previous position would restore the wrong place after a
    // tab flip.
    const scrollRef = createRef<HTMLDivElement>();
    const { hooks, store } = makeReactiveStateStore();
    const restored = { version: 2, index: 0, offsetInRow: 0, totalCount: 3 };
    store.set("ctx-list::snapshot", restored);
    // jsdom measures 0x0; rows render only inside a sized viewport. The list
    // root scrolls with the container (a rect pinned at 0 would read as
    // content above the list growing with every scroll).
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.id === "ctx-root") {
          const scrolled =
            document.querySelector("[data-scroller]")?.scrollTop ?? 0;
          return new DOMRect(0, -scrolled, 800, 1800);
        }
        return new DOMRect(0, 0, 800, 600);
      }
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    const Row: React.FC<{ item: string }> = ({ item }) => {
      const scroller = useVirtualScroller();
      return (
        <button
          onClick={(e) =>
            scroller?.centreInRow(e.currentTarget, new DOMRect(0, 500, 10, 10))
          }
        >
          {item}
        </button>
      );
    };
    const { unmount, getAllByRole } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef} data-scroller="">
          <VirtualList<string>
            persistenceKey="ctx-list"
            id="ctx-root"
            scrollRef={scrollRef}
            data={["a", "b", "c"]}
            renderRow={(_index: number, item: string) => <Row item={item} />}
            live={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    act(() => {
      vi.advanceTimersByTime(50);
    });

    act(() => {
      getAllByRole("button")[0]!.click();
    });
    Object.defineProperty(el, "scrollTop", {
      value: 500,
      configurable: true,
      writable: true,
    });
    el.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersByTime(20);
    });
    // Not persisted as a scroll (the landing is still in flight)...
    expect(store.get("ctx-list::snapshot")).toBe(restored);
    el.dispatchEvent(new Event("scrollend"));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    // ...but recorded once it has settled: rows measure 600px here.
    expect(store.get("ctx-list::snapshot")).toMatchObject({
      version: 2,
      index: 0,
      offsetInRow: 500,
    });
    unmount();
  });

  it("cancels the pending initial-scroll frame on unmount (shared container)", () => {
    // The mount-time initial scroll is scheduled on a rAF that closes over
    // the shared scroll container; the container outlives the list, so a
    // frame surviving unmount would reset whatever view owns it next back
    // to the top (same contract as the finish timer above).
    const scrollRef = createRef<HTMLDivElement>();
    const { unmount } = mountWithStore(scrollRef);
    const el = scrollRef.current!;
    // Do NOT advance timers: the initial-scroll frame is still pending.
    Object.defineProperty(el, "scrollTop", {
      value: 300,
      configurable: true,
      writable: true,
    });
    unmount();
    vi.advanceTimersByTime(50);
    expect(el.scrollTop).toBe(300);
  });
});

describe("VirtualList scrollToIndex", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes a live list out of follow, so streamed rows no longer pull to the tail", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const hooks = makeStateHooks();
    const list = (data: string[]) => (
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            ref={handle}
            persistenceKey="follow-list"
            scrollRef={scrollRef}
            data={data}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={true}
            smoothScroll={false}
          />
        </div>
      </Wrapper>
    );
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    const { rerender, unmount } = render(list(["a", "b", "c"]));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // A fresh live mount follows: content growth scrolls to the tail.
    rerender(list(["a", "b", "c", "d"]));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const followScrolls = scrollTo.mock.calls.length;
    expect(followScrolls).toBeGreaterThan(0);

    act(() => handle.current!.scrollToIndex({ index: 0 }));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const afterJump = scrollTo.mock.calls.length;
    rerender(list(["a", "b", "c", "d", "e"]));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(scrollTo.mock.calls.length).toBe(afterJump);
    unmount();
  });

  it("runs onDone once the virtualizer reports the jump finished", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const { unmount } = render(
      <Wrapper hooks={makeStateHooks()}>
        <div ref={scrollRef}>
          <VirtualList<string>
            ref={handle}
            persistenceKey="done-list"
            scrollRef={scrollRef}
            data={["a", "b", "c"]}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
            smoothScroll={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const onDone = vi.fn();
    act(() => handle.current!.scrollToIndex({ index: 2, onDone }));
    // The jump's scroll event: the virtualizer is scrolling until scrollend.
    el.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDone).not.toHaveBeenCalled();
    el.dispatchEvent(new Event("scrollend"));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("persists the settled landing of a handle jump", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const { hooks, store } = makeReactiveStateStore();
    Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) {
        Object.defineProperty(this, "scrollTop", {
          value: options.top,
          configurable: true,
          writable: true,
        });
      }
    };
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            ref={handle}
            persistenceKey="jump-persist"
            scrollRef={scrollRef}
            data={Array.from({ length: 20 }, (_, i) => `row ${i}`)}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
            smoothScroll={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    // jsdom has no layout: give the scroller room so the jump is not clamped.
    Object.defineProperty(el, "scrollHeight", { value: 8000 });
    Object.defineProperty(el, "clientHeight", { value: 600 });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(store.get("jump-persist::snapshot")).toBeUndefined();

    act(() => handle.current!.scrollToIndex({ index: 10, align: "start" }));
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scrollend"));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(store.get("jump-persist::snapshot")).toMatchObject({
      version: 2,
      index: 10,
      offsetInRow: 0,
    });
    unmount();
  });

  it("persists a jump's landing when unmounted before it settles (a tab flip right after a find jump)", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const { hooks, store } = makeReactiveStateStore();
    Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) {
        Object.defineProperty(this, "scrollTop", {
          value: options.top,
          configurable: true,
          writable: true,
        });
      }
    };
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            ref={handle}
            persistenceKey="jump-unmount"
            scrollRef={scrollRef}
            data={Array.from({ length: 20 }, (_, i) => `row ${i}`)}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
            smoothScroll={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    Object.defineProperty(el, "scrollHeight", { value: 8000 });
    Object.defineProperty(el, "clientHeight", { value: 600 });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    act(() => handle.current!.scrollToIndex({ index: 10, align: "start" }));
    // The jump's scroll event; no scrollend before the list goes away.
    el.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(store.get("jump-unmount::snapshot")).toBeUndefined();
    unmount();
    expect(store.get("jump-unmount::snapshot")).toMatchObject({
      version: 2,
      index: 10,
      offsetInRow: 0,
    });
  });

  it("flushes the landing, not the scroll it replaced, when unmounted inside the persist debounce", () => {
    // A user scroll leaves a debounced save pending; a jump that lands before
    // it fires (a find reveal re-centring) is the position the user sees, and
    // the flush on a tab flip must not resurrect the older one.
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const { hooks, store } = makeReactiveStateStore();
    Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) {
        Object.defineProperty(this, "scrollTop", {
          value: options.top,
          configurable: true,
          writable: true,
        });
      }
    };
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            ref={handle}
            persistenceKey="jump-flush"
            scrollRef={scrollRef}
            data={Array.from({ length: 20 }, (_, i) => `row ${i}`)}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
            smoothScroll={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    Object.defineProperty(el, "scrollHeight", { value: 8000 });
    Object.defineProperty(el, "clientHeight", { value: 600 });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    Object.defineProperty(el, "scrollTop", {
      value: 500,
      configurable: true,
      writable: true,
    });
    el.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersByTime(20);
    });
    act(() => handle.current!.scrollToIndex({ index: 10, align: "start" }));
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scrollend"));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    unmount();
    expect(store.get("jump-flush::snapshot")).toMatchObject({
      version: 2,
      index: 10,
      offsetInRow: 0,
    });
  });

  it("lands a jump requested before the ref-based container resolves, once it attaches", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const onDone = vi.fn();
    // jsdom has no layout: give the scroller room before the jump can run,
    // or the virtualizer clamps it to a zero scrollHeight.
    const attachScroller = (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      if (!el) return;
      Object.defineProperty(el, "scrollHeight", {
        value: 8000,
        configurable: true,
      });
      Object.defineProperty(el, "clientHeight", {
        value: 600,
        configurable: true,
      });
    };
    // A host effect (the transcript's deep-link landing) runs in the mount
    // commit, when the container ref is still a render away from being the
    // list's scroll element.
    const Host = () => {
      useMountEffect(() => {
        handle.current!.scrollToIndex({ index: 10, align: "start", onDone });
      });
      return (
        <Wrapper hooks={makeStateHooks()}>
          <div ref={attachScroller}>
            <VirtualList<string>
              ref={handle}
              persistenceKey="early-deeplink"
              scrollRef={scrollRef}
              data={Array.from({ length: 20 }, (_, i) => `row ${i}`)}
              renderRow={(_index: number, item: string) => <div>{item}</div>}
              live={false}
              smoothScroll={false}
            />
          </div>
        </Wrapper>
      );
    };
    Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) {
        Object.defineProperty(this, "scrollTop", {
          value: options.top,
          configurable: true,
          writable: true,
        });
      }
    };
    const { unmount } = render(<Host />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(scrollRef.current!.scrollTop).toBeGreaterThan(0);
    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("VirtualList auto-scroll guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases the auto-scroll guard after a jump, so user scrolls persist again", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const store = new Map<string, unknown>();
    const getKey = (id: string, prop: string) => `${id}::${prop}`;
    const hooks: ComponentStateHooks = {
      useValue: (id, prop, defaultValue) =>
        store.has(getKey(id, prop))
          ? store.get(getKey(id, prop))
          : defaultValue,
      useSetValue: () => (id, prop, value) => {
        store.set(getKey(id, prop), value);
      },
      useRemoveValue: () => (id, prop) => {
        store.delete(getKey(id, prop));
      },
      useEntries: () => undefined,
      useRemoveAll: () => () => {},
      useRemoveByPrefix: () => () => {},
    };
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            ref={handle}
            persistenceKey="guard-list"
            scrollRef={scrollRef}
            data={["a", "b", "c"]}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
            smoothScroll={false}
          />
        </div>
      </Wrapper>
    );
    vi.advanceTimersByTime(50);
    act(() => handle.current!.scrollToIndex({ index: 2 }));
    act(() => handle.current!.jumpToStart());
    act(() => {
      vi.advanceTimersByTime(100);
    });

    const el = scrollRef.current!;
    Object.defineProperty(el, "scrollTop", {
      value: 500,
      configurable: true,
      writable: true,
    });
    el.dispatchEvent(new Event("wheel"));
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    unmount();
    expect(store.get("guard-list::snapshot")).toMatchObject({
      version: 2,
      index: 1,
    });
  });

  it("releases the guard when the user takes over a still-scrolling jump", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const handle = createRef<VirtualListHandle>();
    const { hooks, store } = makeReactiveStateStore();
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef}>
          <VirtualList<string>
            ref={handle}
            persistenceKey="takeover-list"
            scrollRef={scrollRef}
            data={["a", "b", "c"]}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
            smoothScroll={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    act(() => handle.current!.scrollToIndex({ index: 2 }));
    // No scrollend ever arrives: the virtualizer stays "scrolling".
    el.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    el.dispatchEvent(new Event("wheel"));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    Object.defineProperty(el, "scrollTop", {
      value: 500,
      configurable: true,
      writable: true,
    });
    el.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(store.get("takeover-list::snapshot")).toMatchObject({
      version: 2,
      index: 1,
      offsetInRow: 100,
    });
    unmount();
  });
});

describe("VirtualList embedded in a shared scroll container", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const mountEmbedded = (props?: { resetScrollOnMount?: boolean }) => {
    const scrollRef = createRef<HTMLDivElement>();
    const list = (
      <div ref={scrollRef} data-scroller="">
        <VirtualList<string>
          persistenceKey="embedded-list"
          id="embedded-root"
          scrollRef={scrollRef}
          data={["a", "b", "c"]}
          renderRow={(_index: number, item: string) => <div>{item}</div>}
          live={false}
          embedded={true}
          {...props}
        />
      </div>
    );
    const hooks = makeStateHooks();
    const view = render(<Wrapper hooks={hooks}>{list}</Wrapper>);
    return {
      ...view,
      scrollRef,
      rerenderSame: () =>
        view.rerender(<Wrapper hooks={hooks}>{list}</Wrapper>),
    };
  };

  it("leaves the container position alone by default (host owns it)", () => {
    // Hosts like a stateful tab scroller own the container's position;
    // the list must not fight their restore.
    const { scrollRef, unmount } = mountEmbedded();
    const el = scrollRef.current!;
    el.scrollTop = 250;
    vi.advanceTimersByTime(50);
    expect(el.scrollTop).toBe(250);
    unmount();
  });

  it("resets a snapshot-less mount to top with resetScrollOnMount=true", () => {
    const { scrollRef, unmount } = mountEmbedded({ resetScrollOnMount: true });
    const el = scrollRef.current!;
    // A foreign scrollTop carried by the shared container (e.g. the previous
    // tab's position).
    el.scrollTop = 250;
    vi.advanceTimersByTime(50);
    expect(el.scrollTop).toBe(0);
    unmount();
  });

  it("persists a gesture that scrolls back to where the last programmatic scroll landed", () => {
    // The echo check drops the scroll event of a programmatic scroll by its
    // position; a wheel that returns to that position is a user scroll, and
    // the flip that follows must flush it, not the position before it.
    const scrollRef = createRef<HTMLDivElement>();
    const { hooks, store } = makeReactiveStateStore();
    const { unmount } = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef} data-scroller="">
          <VirtualList<string>
            persistenceKey="wheel-back-list"
            scrollRef={scrollRef}
            data={["a", "b", "c"]}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    // The mount-time reset lands at 0.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const wheelTo = (top: number) => {
      el.scrollTop = top;
      el.dispatchEvent(new Event("wheel"));
      el.dispatchEvent(new Event("scroll"));
      act(() => {
        vi.advanceTimersByTime(20);
      });
    };
    wheelTo(500);
    wheelTo(0);
    unmount();
    expect(store.get("wheel-back-list::snapshot")).toMatchObject({
      version: 2,
      index: 0,
      offsetInRow: 0,
    });
  });

  it("keeps a user scroll that lands while the mount effect re-runs without positioning", () => {
    // Until a snapshot rehydrates, the mount effect re-runs on every
    // measurement; a re-run that writes nothing must not raise the
    // programmatic-scroll guard, or a wheel in that frame is dropped and the
    // flip that follows flushes the position before it.
    const scrollRef = createRef<HTMLDivElement>();
    const { hooks, store } = makeReactiveStateStore();
    const list = (data: string[]) => (
      <Wrapper hooks={hooks}>
        <div ref={scrollRef} data-scroller="">
          <VirtualList<string>
            persistenceKey="rerun-list"
            scrollRef={scrollRef}
            data={data}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
          />
        </div>
      </Wrapper>
    );
    const { rerender, unmount } = render(list(["a", "b", "c"]));
    const el = scrollRef.current!;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const wheelTo = (top: number) => {
      el.scrollTop = top;
      el.dispatchEvent(new Event("wheel"));
      el.dispatchEvent(new Event("scroll"));
    };
    wheelTo(20);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    // A row measuring re-runs the effect; its frame is pending when the
    // wheel returns to the top.
    rerender(list(["a", "b", "c", "d"]));
    wheelTo(0);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    unmount();
    expect(store.get("rerun-list::snapshot")).toMatchObject({
      version: 2,
      index: 0,
      offsetInRow: 0,
    });
  });

  it("still resets to top when the shared container's clamp fires a scroll event before the positioning", () => {
    // Shorter content replacing taller content in the shared container clamps
    // its scrollTop, and the clamp fires a scroll event; it is not the user
    // scrolling this list, so it neither blocks the reset nor gets persisted.
    // The positioning frame is re-armed by a data change after the event, as
    // rows measuring during the swap re-arm it in the browser.
    const scrollRef = createRef<HTMLDivElement>();
    const { hooks, store } = makeReactiveStateStore();
    const list = (data: string[]) => (
      <Wrapper hooks={hooks}>
        <div ref={scrollRef} data-scroller="">
          <VirtualList<string>
            persistenceKey="clamped-list"
            scrollRef={scrollRef}
            data={data}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
          />
        </div>
      </Wrapper>
    );
    const { rerender, unmount } = render(list(["a", "b", "c"]));
    const el = scrollRef.current!;
    el.scrollTop = 250;
    el.dispatchEvent(new Event("scroll"));
    rerender(list(["a", "b", "c", "d"]));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(el.scrollTop).toBe(0);
    expect(store.get("clamped-list::snapshot")).toBeUndefined();
    unmount();
  });

  it("subtracts the list's offset in the container from its own padding", async () => {
    // Content above an embedded list occupies real DOM space; item
    // coordinates include it (TanStack scrollMargin), so the list's spacer
    // must not duplicate it. Layout is mocked before mount: the scroller is
    // 800x600 at top 0, the list root sits 100px below it.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.hasAttribute("data-scroller"))
          return new DOMRect(0, 0, 800, 600);
        if (this.id === "embedded-root") return new DOMRect(0, 100, 800, 1200);
        // jsdom's real implementation also returns a zero rect.
        return new DOMRect();
      }
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);

    const { unmount } = mountEmbedded();
    const root = document.getElementById("embedded-root")!;
    // Rows are laid out from their estimate first and measured in a
    // post-commit microtask (measuring inside the commit makes TanStack
    // flushSync mid-render).
    expect(
      root.querySelectorAll<HTMLElement>("[data-item-index]").item(1).style.top
    ).toBe("400px");
    await act(async () => {});

    // All three (estimated 400px) rows land in or overscan past the 600px
    // viewport, whose window starts at the container's scrollTop (0) —
    // margin-inclusive item coordinates keep them aligned.
    const rows = root.querySelectorAll<HTMLElement>("[data-item-index]");
    expect(rows.length).toBe(3);
    // No top/bottom spacer chunks: the 100px above the list is real
    // content, and the rendered band covers the whole list height.
    expect(root.children.length).toBe(1);
    // Rows are positioned relative to the band, unaffected by the margin
    // (each row measures at the mocked 600px offsetHeight).
    expect(rows.item(0).style.top).toBe("0px");
    expect(rows.item(1).style.top).toBe("600px");
    unmount();
  });

  it("round-trips a container position above the list (host content stays in view)", () => {
    // The list starts 100px down a shared container. Scrolling the container
    // 10px never reaches the list; on return the container must be at 10,
    // not yanked to the list's start.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.hasAttribute("data-scroller"))
          return new DOMRect(0, 0, 800, 600);
        if (this.id === "embedded-root") {
          const scrolled =
            document.querySelector("[data-scroller]")?.scrollTop ?? 0;
          return new DOMRect(0, 100 - scrolled, 800, 1200);
        }
        return new DOMRect();
      }
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    const { hooks, store } = makeReactiveStateStore();
    const mount = () => {
      const scrollRef = createRef<HTMLDivElement>();
      const view = render(
        <Wrapper hooks={hooks}>
          <div ref={scrollRef} data-scroller="">
            <VirtualList<string>
              persistenceKey="embedded-list"
              id="embedded-root"
              scrollRef={scrollRef}
              data={["a", "b", "c"]}
              renderRow={(_index: number, item: string) => <div>{item}</div>}
              live={false}
              embedded={true}
            />
          </div>
        </Wrapper>
      );
      const el = scrollRef.current!;
      Object.defineProperty(el, "scrollHeight", { value: 1900 });
      return { el, unmount: view.unmount };
    };

    const first = mount();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    Object.defineProperty(first.el, "scrollTop", {
      value: 10,
      configurable: true,
      writable: true,
    });
    first.el.dispatchEvent(new Event("wheel"));
    first.el.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    first.unmount();
    expect(store.get("embedded-list::snapshot")).toMatchObject({
      version: 2,
      index: 0,
      offsetInRow: -90,
    });

    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    const second = mount();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 10, behavior: "auto" });
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 100, behavior: "auto" });
    second.unmount();
  });

  // A list under content whose height changes between visits (a collapsing
  // header): the scroller is 800x600 at top 0, the list root sits
  // `contentAbove` px into it.
  const mountUnderContent = (
    contentAbove: () => number,
    hooks: ComponentStateHooks,
    embedded: boolean
  ) => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.hasAttribute("data-scroller"))
          return new DOMRect(0, 0, 800, 600);
        if (this.id === "under-content-root") {
          const scrolled =
            document.querySelector("[data-scroller]")?.scrollTop ?? 0;
          return new DOMRect(0, contentAbove() - scrolled, 800, 8000);
        }
        return new DOMRect();
      }
    );
    const scrollRef = createRef<HTMLDivElement>();
    const view = render(
      <Wrapper hooks={hooks}>
        <div ref={scrollRef} data-scroller="">
          <VirtualList<string>
            persistenceKey="under-content-list"
            id="under-content-root"
            scrollRef={scrollRef}
            data={Array.from({ length: 20 }, (_, i) => `row ${i}`)}
            renderRow={(_index: number, item: string) => <div>{item}</div>}
            live={false}
            embedded={embedded}
          />
        </div>
      </Wrapper>
    );
    const el = scrollRef.current!;
    Object.defineProperty(el, "scrollHeight", { value: 20000 });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    return { el, unmount: view.unmount };
  };
  const scrollTo = (el: HTMLElement, top: number) => {
    Object.defineProperty(el, "scrollTop", {
      value: top,
      configurable: true,
      writable: true,
    });
    el.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
  };

  it("keeps a row at the same viewport y when the content above the list changes height", () => {
    // Not embedded: item coordinates are list-relative while scrollTop is the
    // container's. Saved under a 125px header, restored under a 27px one, the
    // same row must land at the same y — an absolute offset would be 98px
    // (one header delta) too far.
    let contentAbove = 125;
    const { hooks, store } = makeReactiveStateStore();
    const first = mountUnderContent(() => contentAbove, hooks, false);
    scrollTo(first.el, 925);
    first.unmount();
    expect(store.get("under-content-list::snapshot")).toEqual({
      version: 2,
      index: 2,
      offsetInRow: 0,
      totalCount: 20,
    });

    contentAbove = 27;
    const scrollToSpy = vi.fn();
    Element.prototype.scrollTo = scrollToSpy;
    const second = mountUnderContent(() => contentAbove, hooks, false);
    expect(scrollToSpy).toHaveBeenLastCalledWith({
      top: 827,
      behavior: "auto",
    });
    second.unmount();
  });

  it("restores a position above the list start as the container's own offset", () => {
    // The viewport top is in the content above the list: the user is looking
    // at that content, so the container offset is what comes back — not a
    // position relative to a list start that has since moved up (and would
    // clamp to 0).
    let contentAbove = 125;
    const { hooks, store } = makeReactiveStateStore();
    const first = mountUnderContent(() => contentAbove, hooks, true);
    scrollTo(first.el, 10);
    first.unmount();
    expect(store.get("under-content-list::snapshot")).toMatchObject({
      version: 2,
      index: 0,
      containerOffset: 10,
    });

    contentAbove = 27;
    const scrollToSpy = vi.fn();
    Element.prototype.scrollTo = scrollToSpy;
    const second = mountUnderContent(() => contentAbove, hooks, true);
    expect(scrollToSpy).toHaveBeenLastCalledWith({
      top: 10,
      behavior: "auto",
    });
    second.unmount();
  });

  it("ignores embedded margin when the list owns its own scroller", () => {
    // With no external scroll target, scrollParent resolves to the list's own
    // wrapper. Measuring the wrapper against itself degenerates the margin to
    // scrollTop, which feeds back into item coordinates so the window never
    // advances — scrolling would appear frozen at the top.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.id === "own-scroller") return new DOMRect(0, 0, 800, 600);
        return new DOMRect();
      }
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);

    const data = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const { unmount } = render(
      <Wrapper hooks={makeStateHooks()}>
        <VirtualList<string>
          persistenceKey="own-scroll-list"
          id="own-scroller"
          data={data}
          renderRow={(_index: number, item: string) => <div>{item}</div>}
          live={false}
          embedded={true}
        />
      </Wrapper>
    );
    const el = document.getElementById("own-scroller")!;
    vi.advanceTimersByTime(50); // initial scroll settles

    // Scroll deep into the (600px-per-row) list: the rendered window must
    // move past the head rows.
    el.scrollTop = 6000;
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(50);

    const indices = Array.from(
      el.querySelectorAll<HTMLElement>("[data-item-index]")
    ).map((row) => Number(row.dataset.itemIndex));
    expect(Math.min(...indices)).toBeGreaterThan(0);
    unmount();
  });
});
