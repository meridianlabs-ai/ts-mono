// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "../state/ComponentStateContext";
import {
  makeReactiveStateHooks,
  makeStateHooks,
} from "../test/component-state-hooks";

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
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

// jsdom returns "" for computed font-size; parseFloat("") = NaN causes the
// maxCollapsedHeight comparison to fail. Stub getComputedStyle to return 16px.
const origGetComputedStyle = window.getComputedStyle.bind(window);
vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
  const style = origGetComputedStyle(el, pseudo ?? null);
  if (el === document.documentElement) {
    return new Proxy(style, {
      get(target, prop) {
        if (prop === "fontSize") return "16px";
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
function isTruncated(container: HTMLElement): boolean {
  const wrap = container.querySelector(
    '[data-expandable-panel="true"]'
  )?.firstElementChild;
  expect(wrap).toBeInstanceOf(HTMLElement);
  return wrap instanceof HTMLElement && wrap.style.maxHeight !== "";
}

describe("ExpandablePanel auto-expand on find target", () => {
  it.each([
    { name: "no target → truncated", target: null, expectTruncated: true },
    {
      name: "matching target → expanded",
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
});

// The sticky offset rides as an inline `bottom` on some ancestor of the
// button; walking up avoids pinning the test to the exact wrapper nesting.
function stickyBottom(button: HTMLElement): string {
  let el: HTMLElement | null = button;
  while (el && !el.hasAttribute("data-expandable-panel")) {
    if (el.style.bottom !== "") return el.style.bottom;
    el = el.parentElement;
  }
  return "";
}

const hasToggleStrip = (container: HTMLElement) =>
  container.querySelector('[data-nested-toggle-strip="true"]') !== null;

const toggleLabels = () =>
  screen.queryAllByRole("button").map((b) => b.textContent);

const buttonAt = (index: number): HTMLElement => {
  const button = screen.getAllByRole("button")[index];
  if (!button) throw new Error(`no button at index ${index}`);
  return button;
};

describe("ExpandablePanel nesting", () => {
  // Toggling writes collapse state, so these need the reactive store.
  const nested = (
    innerProps: Partial<React.ComponentProps<typeof ExpandablePanel>> = {},
    outerProps: Partial<React.ComponentProps<typeof ExpandablePanel>> = {}
  ) => (
    <ComponentStateProvider hooks={makeReactiveStateHooks()}>
      <ExpandablePanel id="outer" collapse={true} lines={5} {...outerProps}>
        <ExpandablePanel id="inner" collapse={true} lines={5} {...innerProps}>
          {longContent}
        </ExpandablePanel>
      </ExpandablePanel>
    </ComponentStateProvider>
  );

  // Inner toggle (inside the content) precedes the outer one in the DOM.
  const expandOuter = async () => {
    await waitFor(() => expect(toggleLabels()).toEqual(["more...", "more..."]));
    fireEvent.click(buttonAt(1));
    await waitFor(() => expect(toggleLabels()).toEqual(["more...", "less..."]));
  };

  // Whether a nested toggle renders must not depend on an ancestor's
  // overflow: the ancestor measures this subtree, including the toggle.
  it.each(["inline-right", "block-left"] as const)(
    "keeps %s nested toggles while an ancestor is collapsed",
    async (togglePosition) => {
      render(nested({ togglePosition }));
      await waitFor(() =>
        expect(toggleLabels()).toEqual(["more...", "more..."])
      );
    }
  );

  it("lifts a stuck nested toggle above each ancestor toggle on its side", async () => {
    render(nested());
    await expandOuter();
    expect(stickyBottom(buttonAt(1))).toBe("");
    expect(stickyBottom(buttonAt(0))).toBe("calc(0.25em + 24px)");
  });

  it("does not lift for an ancestor that shows no toggle", async () => {
    // 100rem = 1600px exceeds the stubbed 999px scrollHeight: no overflow.
    render(nested({}, { lines: 100 }));
    await waitFor(() => expect(toggleLabels()).toEqual(["more..."]));
    expect(stickyBottom(screen.getByRole("button"))).toBe("");
  });

  it("does not lift a block-left toggle for an inline-right ancestor", async () => {
    render(nested({ togglePosition: "block-left" }));
    await expandOuter();
    expect(stickyBottom(buttonAt(0))).toBe("");
  });

  // jsdom lays nothing out, so every rect is empty and the nested toggle's
  // corner always coincides with the outer panel's.
  it("reserves a strip below a nested toggle sharing its corner while expanded", async () => {
    const { container } = render(nested());
    await waitFor(() => expect(toggleLabels()).toEqual(["more...", "more..."]));
    expect(hasToggleStrip(container)).toBe(false);

    await expandOuter();
    await waitFor(() => expect(hasToggleStrip(container)).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "less..." }));
    await waitFor(() => expect(toggleLabels()).toEqual(["more...", "more..."]));
    expect(hasToggleStrip(container)).toBe(false);
  });

  it("reserves no strip for a nested block-left toggle", async () => {
    const { container } = render(nested({ togglePosition: "block-left" }));
    await expandOuter();
    expect(hasToggleStrip(container)).toBe(false);
  });

  it("reserves no strip when the nested panel has no toggle", async () => {
    const { container } = render(nested({ lines: 100 }));
    await waitFor(() => expect(toggleLabels()).toEqual(["more..."]));
    fireEvent.click(screen.getByRole("button", { name: "more..." }));
    await waitFor(() => expect(toggleLabels()).toEqual(["less..."]));
    expect(hasToggleStrip(container)).toBe(false);
  });

  it("leaves a non-nested panel unchanged", async () => {
    const { container } = render(
      <Wrapper findTarget={null}>
        <ExpandablePanel id="solo" collapse={false} lines={5}>
          {longContent}
        </ExpandablePanel>
      </Wrapper>
    );
    await waitFor(() => expect(toggleLabels()).toEqual(["less..."]));
    expect(stickyBottom(screen.getByRole("button"))).toBe("");
    expect(hasToggleStrip(container)).toBe(false);
  });
});
