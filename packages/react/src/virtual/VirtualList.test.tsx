// @vitest-environment jsdom
import { render } from "@testing-library/react";
import {
  createRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtendedFindProvider } from "../components/ExtendedFindContext";
import {
  ComponentStateHooks,
  ComponentStateProvider,
} from "../state/ComponentStateContext";
import {
  makeReactiveStateHooks,
  makeStateHooks,
} from "../test/component-state-hooks";

import { VirtualList } from "./VirtualList";

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
  const makeInspectableHooks = () => {
    const store = new Map<string, unknown>();
    const listeners = new Set<() => void>();
    let version = 0;
    const subscribe = (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    };
    const emit = () => {
      version++;
      listeners.forEach((l) => l());
    };
    const key = (id: string, prop: string) => `${id}::${prop}`;
    const setValue = (id: string, prop: string, value: unknown) => {
      const k = key(id, prop);
      if (!store.has(k) || store.get(k) !== value) {
        store.set(k, value);
        emit();
      }
    };
    const hooks: ComponentStateHooks = {
      useValue: (id: string, prop: string, defaultValue?: unknown) => {
        useSyncExternalStore(subscribe, () => version);
        return store.has(key(id, prop))
          ? store.get(key(id, prop))
          : defaultValue;
      },
      useSetValue: () => setValue,
      useRemoveValue: () => (id: string, prop: string) => {
        if (store.delete(key(id, prop))) emit();
      },
      useEntries: () => undefined,
      useRemoveAll: () => () => {},
      useRemoveByPrefix: () => () => {},
    };
    return { hooks, store };
  };

  const mountFollow = (
    props: Partial<React.ComponentProps<typeof VirtualList<string>>>,
    seedFollow?: boolean
  ) => {
    const { hooks, store } = makeInspectableHooks();
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
    const { hooks, store } = makeInspectableHooks();
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
  });

  const mountWithStore = (scrollRef: RefObject<HTMLDivElement | null>) => {
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

    expect(store.get("flush-list::snapshot")).toMatchObject({
      scrollOffset: 500,
    });

    // And nothing fires later against the departed container.
    store.delete("flush-list::snapshot");
    vi.advanceTimersByTime(1000);
    expect(store.get("flush-list::snapshot")).toBeUndefined();
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

  it("subtracts the list's offset in the container from its own padding", () => {
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
