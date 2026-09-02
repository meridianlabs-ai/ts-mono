// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import React, { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FindProvider,
  FindRowProvider,
  useFindCoordinatorOptional,
  useFindHighlights,
} from "../find";
import type { FindCoordinator, FindRow } from "../find";
import { useMountEffect } from "../hooks/useMountEffect";
import { ComponentStateProvider } from "../state/ComponentStateContext";
import { makeStateHooks } from "../test/component-state-hooks";

import { ExpandablePanel } from "./ExpandablePanel";
import { FindTargetProvider } from "./FindTargetContext";

// --- ResizeObserver shim ---
// jsdom does not fire ResizeObserver callbacks, so showToggle stays false and
// expandableTruncated is never applied. We replace ResizeObserver with a shim
// that immediately fires the callback when observe() is called (synchronously,
// post-mount inside useEffect), ensuring showToggle=true.
class FakeResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    // Fire synchronously so React batches the setShowToggle(true) update
    // inside the same act() wrapping as the initial render.
    const box: ResizeObserverSize = { blockSize: 0, inlineSize: 0 };
    this.cb(
      [
        {
          target: el,
          contentRect: new DOMRectReadOnly(0, 0, 0, 0),
          borderBoxSize: [box],
          contentBoxSize: [box],
          devicePixelContentBoxSize: [box],
        },
      ],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}
// Per test: a test that stubs other globals unstubs them all when done.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

// jsdom returns "" for computed font-size; parseFloat("") = NaN causes the
// maxCollapsedHeight comparison to fail. Stub the root font size (16px unless
// a test sets it).
let rootFontSize = "16px";
const origGetComputedStyle = window.getComputedStyle.bind(window);
vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
  const style = origGetComputedStyle(el, pseudo ?? null);
  if (el === document.documentElement) {
    return new Proxy(style, {
      get(target, prop) {
        if (prop === "fontSize") return rootFontSize;
        const val: unknown = Reflect.get(target, prop);
        if (typeof val !== "function") return val;
        const bound: unknown = val.bind(target);
        return bound;
      },
    });
  }
  return style;
});

// Make scrollHeight appear tall (999px >> 5rem=80px) so checkOverflow sets
// showToggle=true.
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    return 999;
  },
});

// jsdom has no Range.getClientRects at all; tests spy on this stub.
Range.prototype.getClientRects = () =>
  Object.assign([] as DOMRect[], { item: () => null });

afterEach(() => {
  rootFontSize = "16px";
});

const Wrapper: React.FC<{
  findTarget: { term: string; eventId: string } | null;
  children: React.ReactNode;
}> = ({ findTarget, children }) => {
  const [hooks] = useState(() => makeStateHooks());
  return (
    <ComponentStateProvider hooks={hooks}>
      <FindTargetProvider value={findTarget}>{children}</FindTargetProvider>
    </ComponentStateProvider>
  );
};

const longContent = (
  <div>
    {Array.from({ length: 50 }).map((_, i) => (
      <p key={i}>Line {i}: lorem ipsum dolor sit amet</p>
    ))}
    <p data-testid="needle-paragraph">contains the wondering needle</p>
  </div>
);

// Truncation is signalled by inline `maxHeight` on the content wrapper —
// an `effectiveCollapsed=true` panel sets it to `${lines}rem`, an expanded
// panel leaves it empty. Asserting on the inline style sidesteps the CSS
// module classname (which would change if the rule were renamed).
function clientRectList(rect: DOMRect): DOMRectList {
  return Object.assign([rect], {
    item: (i: number) => (i === 0 ? rect : null),
  });
}

async function withRangeClientRects(
  rects: DOMRectList,
  run: () => Promise<void>
): Promise<void> {
  const spy = vi
    .spyOn(Range.prototype, "getClientRects")
    .mockImplementation(() => rects);
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
}

function isTruncated(container: HTMLElement): boolean {
  const wrap = container.querySelector(
    '[data-expandable-panel="true"]'
  )?.firstElementChild;
  expect(wrap).toBeInstanceOf(HTMLElement);
  return wrap instanceof HTMLElement && wrap.style.maxHeight !== "";
}

/** A find row as the chat list renders one: highlighter plus provider. */
const FindRowFixture: React.FC<{
  anchorId: string;
  children: React.ReactNode;
}> = ({ anchorId, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const row = useFindHighlights(ref, anchorId);
  return (
    <FindRowProvider value={row}>
      <div ref={ref} data-find-anchor={anchorId}>
        {children}
      </div>
    </FindRowProvider>
  );
};

function rowSource(row: Omit<FindRow, "index">) {
  return {
    find: () =>
      Promise.resolve({
        rows: [{ ...row, index: 0 }],
        atEnd: true,
        complete: true,
      }),
  };
}

/** Mounts `children` under a FindProvider and returns the coordinator. */
function renderWithCoordinator(
  children: React.ReactNode
): [ReturnType<typeof render>, FindCoordinator] {
  const captured: { coordinator?: FindCoordinator } = {};
  const Probe = () => {
    const coordinator = useFindCoordinatorOptional();
    useMountEffect(() => {
      captured.coordinator = coordinator ?? undefined;
    });
    return null;
  };
  const view = render(
    <FindProvider>
      <Probe />
      {children}
    </FindProvider>
  );
  if (!captured.coordinator) throw new Error("coordinator not mounted");
  return [view, captured.coordinator];
}

describe("ExpandablePanel auto-expand on find target", () => {
  it.each([
    { name: "no target → truncated", target: null, expectTruncated: true },
    {
      name: "matching target without a find row still expands (legacy window.find)",
      target: { term: "wondering", eventId: "e1" },
      expectTruncated: false,
    },
    {
      name: "non-matching target → truncated",
      target: { term: "absent-term-xyz", eventId: "e1" },
      expectTruncated: true,
    },
  ])("$name", async ({ target, expectTruncated }) => {
    const { container } = render(
      <Wrapper findTarget={target}>
        <ExpandablePanel id="p" collapse={true} lines={5}>
          {longContent}
        </ExpandablePanel>
      </Wrapper>
    );
    await waitFor(() => {
      expect(isTruncated(container)).toBe(expectTruncated);
    });
  });

  it("mounts a non-matching panel truncated, never expanded first (a row's reveal centres against the mount layout)", () => {
    const maxHeightsAtMount: string[] = [];
    const { container } = render(
      <Wrapper findTarget={{ term: "absent-term-xyz", eventId: "e1" }}>
        <ExpandablePanel id="p" collapse={true} lines={5}>
          <div
            ref={(el) => {
              if (el) maxHeightsAtMount.push(el.parentElement!.style.maxHeight);
            }}
          >
            {longContent}
          </div>
        </ExpandablePanel>
      </Wrapper>
    );
    expect(maxHeightsAtMount[0]).toBe("5rem");
    expect(isTruncated(container)).toBe(true);
  });

  it("returns to truncated state when target clears", async () => {
    const hooks = makeStateHooks();
    const tree = (target: { term: string; eventId: string } | null) => (
      <ComponentStateProvider hooks={hooks}>
        <FindTargetProvider value={target}>
          <ExpandablePanel id="p3" collapse={true} lines={5}>
            {longContent}
          </ExpandablePanel>
        </FindTargetProvider>
      </ComponentStateProvider>
    );
    const { rerender, container } = render(
      tree({ term: "wondering", eventId: "e1" })
    );
    await waitFor(() => expect(isTruncated(container)).toBe(false));
    rerender(tree(null));
    await waitFor(() => expect(isTruncated(container)).toBe(true));
  });

  it("expands for the variants the find source matched, not only the typed term, and collapses again when the term clears", async () => {
    const [{ container }, coordinator] = renderWithCoordinator(
      <Wrapper findTarget={{ term: "cafe", eventId: "e1" }}>
        <FindRowFixture anchorId="r">
          <ExpandablePanel id="p" collapse={true} lines={5}>
            {"café au lait ".repeat(50)}
          </ExpandablePanel>
        </FindRowFixture>
      </Wrapper>
    );
    await waitFor(() => expect(isTruncated(container)).toBe(true));

    await withRangeClientRects(
      clientRectList(new DOMRect(0, 200, 40, 16)),
      async () => {
        act(() => {
          coordinator.registerSurface({
            scopeId: "test",
            source: rowSource({
              anchor: { id: "r" },
              count: 1,
              texts: ["café"],
            }),
            reveal: () => {},
          });
          coordinator.setTerm("cafe");
        });
        await waitFor(() => expect(isTruncated(container)).toBe(false));
        act(() => coordinator.setTerm(""));
        await waitFor(() => expect(isTruncated(container)).toBe(true));
      }
    );
  });

  it("does not grow a find row when the first letter matches in the visible fold", async () => {
    const [{ container }, coordinator] = renderWithCoordinator(
      <Wrapper findTarget={{ term: "c", eventId: "e1" }}>
        <FindRowFixture anchorId="r">
          <ExpandablePanel id="p-fold" collapse={true} lines={5}>
            {longContent}
          </ExpandablePanel>
        </FindRowFixture>
      </Wrapper>
    );
    coordinator.registerSurface({
      scopeId: "test",
      source: rowSource({ anchor: { id: "r" }, count: 1, texts: ["c"] }),
      reveal: () => {},
    });
    await withRangeClientRects(
      clientRectList(new DOMRect(0, 20, 40, 16)),
      async () => {
        act(() => coordinator.setTerm("c"));
        await waitFor(() => expect(coordinator.getState().activeRow).toBe(0));
        expect(isTruncated(container)).toBe(true);
      }
    );
  });

  it("measures the fold in the root font size: a hit 95px down a 5-line fold at 20px/rem stays folded", async () => {
    rootFontSize = "20px";
    // Custom Highlights stubbed so the test can wait for the row's scan; the
    // hit counts as in view (jsdom has no elementFromPoint), so no scroll.
    const highlights = new Map<string, Set<Range>>();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal("Highlight", Set);
    document.elementFromPoint = () =>
      document.querySelector("[data-find-anchor]");
    const [{ container }, coordinator] = renderWithCoordinator(
      <Wrapper findTarget={{ term: "cafe", eventId: "e1" }}>
        <FindRowFixture anchorId="r">
          <ExpandablePanel id="p-rem" collapse={true} lines={5}>
            {"café au lait ".repeat(50)}
          </ExpandablePanel>
        </FindRowFixture>
      </Wrapper>
    );
    // The hit's box ends at 95px: below a 16px-guessed 5-line fold (80px),
    // inside the real one (100px).
    await withRangeClientRects(
      clientRectList(new DOMRect(0, 79, 40, 16)),
      async () => {
        act(() => {
          coordinator.registerSurface({
            scopeId: "test",
            source: rowSource({
              anchor: { id: "r" },
              count: 1,
              texts: ["café"],
            }),
            reveal: () => {},
          });
          coordinator.setTerm("cafe");
        });
        await waitFor(() =>
          expect(highlights.get("find-active")?.size ?? 0).toBe(1)
        );
        expect(isTruncated(container)).toBe(true);
      }
    );
    vi.unstubAllGlobals();
  });

  it("expands when matching text appears after mount (lazy subtree)", async () => {
    const LateNeedle = () => {
      const [ready, setReady] = useState(false);
      useMountEffect(() => {
        setReady(true);
      });
      return ready ? (
        <p>{"wondering needle ".repeat(50)}</p>
      ) : (
        <p>{"placeholder ".repeat(50)}</p>
      );
    };
    const { container } = render(
      <Wrapper findTarget={{ term: "wondering", eventId: "e1" }}>
        <ExpandablePanel id="p-late" collapse={true} lines={5}>
          <LateNeedle />
        </ExpandablePanel>
      </Wrapper>
    );
    await waitFor(() => expect(isTruncated(container)).toBe(false));
  });
});
