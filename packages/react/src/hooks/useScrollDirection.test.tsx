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
