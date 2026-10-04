// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useScrollDirection,
  type UseScrollDirectionResult,
} from "./useScrollDirection";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

function Harness({
  elRef,
  suppressed,
  onHidden,
}: {
  elRef: RefObject<HTMLElement | null>;
  suppressed?: boolean;
  onHidden: (hidden: boolean) => void;
}) {
  const suppressRef = useRef(!!suppressed);
  const { hidden } = useScrollDirection(elRef, {
    initialHidden: true,
    suppressRef,
  });
  onHidden(hidden);
  return null;
}

const makeEl = () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
};

async function swapElement(elRef: { current: HTMLElement | null }) {
  await act(async () => {
    elRef.current = makeEl();
    // the hook re-resolves elements via MutationObserver on body
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("useScrollDirection hidden state across scroller remounts", () => {
  it("resets hidden when the element remounts and detection is live", async () => {
    const elRef: { current: HTMLElement | null } = { current: makeEl() };
    let hidden: boolean | undefined;
    render(
      <Harness
        elRef={elRef as RefObject<HTMLElement | null>}
        onHidden={(h) => (hidden = h)}
      />
    );
    expect(hidden).toBe(true);
    await swapElement(elRef);
    // A fresh scroller starts at the top — natural consumers (scout result /
    // transcript switches) must not inherit a stale collapsed headroom.
    expect(hidden).toBe(false);
  });

  it("keeps hidden across the remount while suppressed (nav-owned mounts)", async () => {
    const elRef: { current: HTMLElement | null } = { current: makeEl() };
    let hidden: boolean | undefined;
    render(
      <Harness
        elRef={elRef as RefObject<HTMLElement | null>}
        suppressed={true}
        onHidden={(h) => (hidden = h)}
      />
    );
    expect(hidden).toBe(true);
    await swapElement(elRef);
    // The loading→loaded swap on a deep-link mount must NOT wipe the forced
    // collapsed state — that painted the chrome expanded mid-landing.
    expect(hidden).toBe(true);
  });
});

function LockHarness({
  elRef,
  onApi,
}: {
  elRef: RefObject<HTMLElement | null>;
  onApi: (api: UseScrollDirectionResult) => void;
}) {
  const api = useScrollDirection(elRef);
  onApi(api);
  return null;
}

// A scroller jsdom treats as scrollable: the handler's at-bottom guard reads
// scrollHeight/clientHeight, which jsdom reports as 0 by default.
const makeScrollableEl = () => {
  const el = makeEl();
  Object.defineProperty(el, "scrollHeight", { value: 2000 });
  Object.defineProperty(el, "clientHeight", { value: 500 });
  return el;
};

describe("useScrollDirection transition lock semantics", () => {
  it("a scroll-driven lock engaged after resetAnchor(true) + setHidden expires instead of self-extending", () => {
    vi.useFakeTimers();
    const el = makeScrollableEl();
    const elRef: RefObject<HTMLElement | null> = { current: el };
    let api: UseScrollDirectionResult | undefined;
    render(<LockHarness elRef={elRef} onApi={(a) => (api = a)} />);

    const scrollTo = (top: number) => {
      el.scrollTop = top;
      act(() => {
        el.dispatchEvent(new Event("scroll"));
      });
    };

    // The transcript search-next sequence: a self-extending programmatic
    // lock, immediately superseded by an imperative setHidden.
    act(() => api!.resetAnchor(true));
    act(() => api!.setHidden(true));
    expect(api!.hidden).toBe(true);

    // Let that lock expire, then anchor mid-scroller (down, no state change).
    act(() => {
      vi.advanceTimersByTime(300);
    });
    scrollTo(1000);

    // Upward direction change reveals and engages an ORDINARY transition
    // lock — the one whose semantics are under test.
    scrollTo(500);
    expect(api!.hidden).toBe(false);

    // Scroll steadily downward, each event past the threshold and inside
    // 250ms of the last. A lock that wrongly inherited the programmatic
    // flag re-arms its expiry on every event and never releases, so hidden
    // would stay false for as long as scrolling continues.
    for (let i = 1; i <= 6; i++) {
      act(() => {
        vi.advanceTimersByTime(100);
      });
      scrollTo(500 + i * 60);
    }
    expect(api!.hidden).toBe(true);
  });
});

function MultiHarness({
  refs,
  onHidden,
}: {
  refs: RefObject<HTMLElement | null>[];
  onHidden: (hidden: boolean) => void;
}) {
  const { hidden } = useScrollDirection(refs);
  onHidden(hidden);
  return null;
}

const scrollDown = (el: HTMLElement) => {
  el.scrollTop = 200;
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
};

describe("useScrollDirection with a list of scrollers", () => {
  it("follows a list that changes length between renders", async () => {
    const consoleError = vi.spyOn(console, "error");
    const refs: RefObject<HTMLElement | null>[] = [1, 2, 3].map(() => ({
      current: makeScrollableEl(),
    }));
    const added: RefObject<HTMLElement | null> = {
      current: makeScrollableEl(),
    };
    let hidden: boolean | undefined;
    const { rerender } = render(
      <MultiHarness refs={refs} onHidden={(h) => (hidden = h)} />
    );

    await act(async () => {
      rerender(
        <MultiHarness refs={[...refs, added]} onHidden={(h) => (hidden = h)} />
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    scrollDown(added.current!);

    expect(hidden).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps its state when the caller passes a fresh array of the same refs", () => {
    const refs: RefObject<HTMLElement | null>[] = [1, 2].map(() => ({
      current: makeScrollableEl(),
    }));
    let hidden: boolean | undefined;
    const { rerender } = render(
      <MultiHarness refs={[...refs]} onHidden={(h) => (hidden = h)} />
    );
    scrollDown(refs[0]!.current!);
    expect(hidden).toBe(true);

    rerender(<MultiHarness refs={[...refs]} onHidden={(h) => (hidden = h)} />);

    expect(hidden).toBe(true);
  });

  it("stays collapsed when a secondary scroller joins the list", () => {
    const refs: RefObject<HTMLElement | null>[] = [1, 2].map(() => ({
      current: makeScrollableEl(),
    }));
    const added: RefObject<HTMLElement | null> = {
      current: makeScrollableEl(),
    };
    let hidden: boolean | undefined;
    const { rerender } = render(
      <MultiHarness refs={refs} onHidden={(h) => (hidden = h)} />
    );
    scrollDown(refs[0]!.current!);
    expect(hidden).toBe(true);

    rerender(
      <MultiHarness refs={[...refs, added]} onHidden={(h) => (hidden = h)} />
    );

    // The primary scroller is still scrolled down, so the headroom must not
    // re-expand just because another tab's scroller appeared.
    expect(hidden).toBe(true);
  });

  it("re-expands when the primary scroller is replaced", () => {
    const refs: RefObject<HTMLElement | null>[] = [1, 2].map(() => ({
      current: makeScrollableEl(),
    }));
    const primary: RefObject<HTMLElement | null> = {
      current: makeScrollableEl(),
    };
    let hidden: boolean | undefined;
    const { rerender } = render(
      <MultiHarness refs={refs} onHidden={(h) => (hidden = h)} />
    );
    scrollDown(refs[0]!.current!);
    expect(hidden).toBe(true);

    rerender(
      <MultiHarness refs={[primary, refs[1]!]} onHidden={(h) => (hidden = h)} />
    );

    expect(hidden).toBe(false);
  });
});
