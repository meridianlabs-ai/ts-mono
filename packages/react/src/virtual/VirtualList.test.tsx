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

import {
  countMatchesInTexts,
  cursorAdvances,
  findScanOrigin,
  itemOccurrenceAtSelection,
  nextMatchingItem,
  occurrenceOrdinal,
  VirtualList,
} from "./VirtualList";

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

    const snapshot = store.get("flush-list::snapshot") as
      { scrollOffset: number } | undefined;
    expect(snapshot?.scrollOffset).toBe(500);

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

describe("nextMatchingItem", () => {
  // Matches at 2, 3, 4 (a dense cluster, like a code block using the term on
  // adjacent lines) and a far one at 9.
  const texts = [
    ["nothing"],
    ["nothing"],
    ["cancel one"],
    ["cancel two"],
    ["cancel three"],
    ["nothing"],
    ["nothing"],
    ["nothing"],
    ["nothing"],
    ["cancel far"],
  ];
  const term = ["cancel"];

  it("advances by exactly one match per call, walking a dense cluster", () => {
    // Regression guard for the cycling: driving the scan from a viewport's
    // trailing edge skipped 3 and 4 (both inside the rendered window after
    // centring 2), which is what produced the short repeating cycle.
    const walk: number[] = [];
    let cursor = 1;
    for (let i = 0; i < 4; i++) {
      const next = nextMatchingItem(texts, term, cursor, true);
      expect(next).not.toBeNull();
      walk.push(next!);
      cursor = next!;
    }
    expect(walk).toEqual([2, 3, 4, 9]);
  });

  it("walks backward symmetrically", () => {
    const walk: number[] = [];
    let cursor = 9;
    for (let i = 0; i < 3; i++) {
      const next = nextMatchingItem(texts, term, cursor, false);
      walk.push(next!);
      cursor = next!;
    }
    expect(walk).toEqual([4, 3, 2]);
  });

  it("wraps forward past the last match", () => {
    expect(nextMatchingItem(texts, term, 9, true)).toBe(2);
  });

  it("wraps backward past the first match", () => {
    expect(nextMatchingItem(texts, term, 2, false)).toBe(9);
  });

  it("re-finds the only matching item so window.find can walk it internally", () => {
    const single = [["nothing"], ["cancel here"], ["nothing"]];
    expect(nextMatchingItem(single, term, 1, true)).toBe(1);
  });

  it("tolerates a negative origin (empty list seeded from an empty viewport)", () => {
    const atZero = [["cancel first"], ["nothing"]];
    expect(nextMatchingItem(atZero, term, -1, true)).toBe(0);
  });

  it("returns null when nothing matches", () => {
    expect(nextMatchingItem(texts, ["absent"], 0, true)).toBeNull();
  });

  it("returns null for an empty term or empty list", () => {
    expect(nextMatchingItem(texts, [""], 0, true)).toBeNull();
    expect(nextMatchingItem([], term, 0, true)).toBeNull();
  });
});

describe("occurrenceOrdinal", () => {
  const texts = [["cancel a cancel b"], ["none"], ["cancel c"]];

  it("counts occurrences in preceding items, matching the displayed total", () => {
    // Item 0 holds two occurrences, so item 2's first occurrence is ordinal 2 —
    // and countMatchesInTexts totals 3, so the band reads "3 of 3".
    expect(occurrenceOrdinal(texts, "cancel", 2, 0)).toBe(2);
    expect(countMatchesInTexts(texts, "cancel")).toBe(3);
  });

  it("adds the occurrence index within the item", () => {
    expect(occurrenceOrdinal(texts, "cancel", 0, 0)).toBe(0);
    expect(occurrenceOrdinal(texts, "cancel", 0, 1)).toBe(1);
  });

  it("declines an occurrence the item's search text cannot account for", () => {
    // The DOM can render text the search accessor never contributed (a chat
    // row renders its role above its content), so a rendered occurrence index
    // can overrun the counted total. Reporting it would render "2 of 1".
    expect(occurrenceOrdinal(texts, "cancel", 2, 1)).toBeNull();
    expect(occurrenceOrdinal(texts, "cancel", 0, 2)).toBeNull();
  });

  it("declines an item index past the end of the list", () => {
    expect(occurrenceOrdinal(texts, "cancel", 99, 0)).toBeNull();
  });

  it("never reports an ordinal the total cannot contain", () => {
    const total = countMatchesInTexts(texts, "cancel");
    for (let item = 0; item < texts.length + 1; item++) {
      for (let occ = 0; occ < 4; occ++) {
        const ordinal = occurrenceOrdinal(texts, "cancel", item, occ);
        if (ordinal !== null) expect(ordinal).toBeLessThan(total);
      }
    }
  });
});

describe("itemOccurrenceAtSelection", () => {
  const selectIn = (node: Text, start: number, length: number) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const build = () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-item-index="0"><span>cancel one</span></div>' +
      '<div data-item-index="3"><span>x cancel y cancel z</span></div>';
    document.body.appendChild(root);
    return root;
  };

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("reports the row index and the occurrence within it", () => {
    const root = build();
    const span = root.querySelectorAll("span")[1]!;
    const text = span.firstChild as Text;
    // Select the SECOND "cancel" in the row (offset 11).
    selectIn(text, 11, 6);

    expect(itemOccurrenceAtSelection(root, "cancel")).toEqual({
      itemIndex: 3,
      occurrence: 1,
    });
  });

  it("reports occurrence 0 for the first match in a row", () => {
    const root = build();
    const text = root.querySelectorAll("span")[1]!.firstChild as Text;
    selectIn(text, 2, 6);

    expect(itemOccurrenceAtSelection(root, "cancel")).toEqual({
      itemIndex: 3,
      occurrence: 0,
    });
  });

  it("rejects a selection belonging to another list", () => {
    // Two lists mounted together must not claim each other's selections, or
    // the ordinal would index into the wrong corpus.
    const mine = build();
    const theirs = document.createElement("div");
    theirs.innerHTML = '<div data-item-index="0"><span>cancel</span></div>';
    document.body.appendChild(theirs);
    const text = theirs.querySelector("span")!.firstChild as Text;
    selectIn(text, 0, 6);

    expect(itemOccurrenceAtSelection(theirs, "cancel")).not.toBeNull();
    expect(itemOccurrenceAtSelection(mine, "cancel")).toBeNull();
  });

  it("returns null with no selection, or a selection outside any row", () => {
    const root = build();
    expect(itemOccurrenceAtSelection(root, "cancel")).toBeNull();

    const stray = document.createElement("div");
    stray.textContent = "cancel";
    root.appendChild(stray);
    selectIn(stray.firstChild as Text, 0, 6);
    expect(itemOccurrenceAtSelection(root, "cancel")).toBeNull();
  });
});

describe("findScanOrigin", () => {
  // After centring a match, the rendered window straddles it. The old code
  // scanned from range.endIndex, so everything between the match and the
  // window's trailing edge was unreachable, and a press arriving before the
  // post-render commit reused the same origin entirely.
  const range = { startIndex: 20, endIndex: 40 };
  const SESSION = 7;
  const cursor = (index: number, term = "cancel", session = SESSION) => ({
    term,
    index,
    session,
  });

  it("uses the session cursor, not the viewport, once a term is being walked", () => {
    expect(
      findScanOrigin(cursor(30), "cancel", SESSION, 100, true, range)
    ).toBe(30);
    expect(
      findScanOrigin(cursor(30), "cancel", SESSION, 100, false, range)
    ).toBe(30);
  });

  it("is unaffected by a viewport that has not caught up with the scroll", () => {
    // The whole point of the cursor: the viewport trails its own scroll, so
    // it must not be consulted while a walk is in progress.
    const stale = { startIndex: 0, endIndex: 0 };
    expect(
      findScanOrigin(cursor(30), "cancel", SESSION, 100, true, stale)
    ).toBe(30);
  });

  it("seeds a first press past the rendered window, not inside it", () => {
    // This path runs only once window.find has exhausted the rendered DOM, so
    // every on-screen match has already been walked and seeding inside the
    // window would re-cover it. Measured on the nanogpt sample: seeding at
    // startIndex - 1 made the first two presses revisit row 0.
    expect(findScanOrigin(null, "cancel", SESSION, 100, true, range)).toBe(40);
    expect(findScanOrigin(null, "cancel", SESSION, 100, false, range)).toBe(20);
  });

  it("re-seeds when the term changes", () => {
    expect(
      findScanOrigin(cursor(30, "other"), "cancel", SESSION, 100, true, range)
    ).toBe(40);
  });

  it("re-seeds when the remembered index no longer addresses the data", () => {
    // The list shrank under the session (streaming chat, filter applied).
    expect(findScanOrigin(cursor(30), "cancel", SESSION, 10, true, range)).toBe(
      40
    );
  });

  it("re-seeds when the remembered index is one past the last item", () => {
    // Exactly the boundary: a list that shrank by one leaves the cursor
    // addressing a slot that no longer exists.
    expect(findScanOrigin(cursor(10), "cancel", SESSION, 10, true, range)).toBe(
      40
    );
  });

  it("re-seeds a cursor left over from an earlier find session", () => {
    // The find band unmounts on Escape but the list does not, so a cursor
    // outlives its session. Reopening find after scrolling elsewhere must not
    // resume hundreds of rows away and strand everything in between.
    expect(
      findScanOrigin(
        cursor(400, "cancel", SESSION - 1),
        "cancel",
        SESSION,
        1000,
        true,
        {
          startIndex: 0,
          endIndex: 14,
        }
      )
    ).toBe(14);
  });

  it("keeps a far-from-viewport cursor that belongs to the current session", () => {
    // A long jump legitimately leaves the cursor far outside a viewport that
    // has not committed yet; only session identity may reject a cursor.
    expect(
      findScanOrigin(cursor(400), "cancel", SESSION, 1000, true, {
        startIndex: 0,
        endIndex: 14,
      })
    ).toBe(400);
  });
});

describe("cursorAdvances", () => {
  const cursor = { term: "cancel", index: 1711, session: 1 };

  it("rejects a selection behind the cursor during a forward walk", () => {
    // The deadlock this exists to prevent: the scroll to row 1711 never
    // commits, window.find re-lands on row 1705 inside the stale window, and
    // an unguarded update pins the cursor there for every later press.
    expect(cursorAdvances(cursor, "cancel", 1705, "forward")).toBe(false);
  });

  it("accepts a selection ahead of the cursor during a forward walk", () => {
    // window.find walking occurrences within the rendered rows legitimately
    // moves the cursor on, so the next extended press does not re-cover them.
    expect(cursorAdvances(cursor, "cancel", 1715, "forward")).toBe(true);
  });

  it("mirrors the rule when walking backward", () => {
    expect(cursorAdvances(cursor, "cancel", 1715, "backward")).toBe(false);
    expect(cursorAdvances(cursor, "cancel", 1705, "backward")).toBe(true);
  });

  it("rejects a selection on the cursor's own row", () => {
    expect(cursorAdvances(cursor, "cancel", 1711, "forward")).toBe(false);
  });

  it("accepts anything when the term changed or nothing is remembered", () => {
    expect(cursorAdvances(cursor, "other", 3, "forward")).toBe(true);
    expect(cursorAdvances(null, "cancel", 3, "forward")).toBe(true);
  });
});
