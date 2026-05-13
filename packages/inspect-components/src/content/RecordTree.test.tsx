// @vitest-environment jsdom
//
// Regression tests for the customScrollParent migration (see
// meridianlabs-ai/ts-mono#90). The hazard being guarded against:
// `customScrollParent={scrollRef.current ?? undefined}` read during render
// captures `null` on the initial pass. Virtuoso then receives `undefined`
// and only sees the real parent if some other re-render happens to fire.
//
// These tests pin the externally observable behavior:
//   1. The unvirtualized path still works when no scrollRef is passed.
//   2. The virtualized path resolves the ref target into a state-backed
//      element and forwards it to Virtuoso (no longer `undefined`) after
//      the post-mount effect runs.

import { cleanup, render, waitFor } from "@testing-library/react";
import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "@tsmono/react/state";

import { RecordTree } from "./RecordTree";

// jsdom ships no ResizeObserver; ExpandablePanel (rendered for each record
// row) wires one up via useResizeObserver. A no-op shim is sufficient — we
// don't depend on observer callbacks firing.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

// Capture what Virtuoso is given for customScrollParent across renders.
const customScrollParents: Array<HTMLElement | undefined> = [];

vi.mock("react-virtuoso", () => {
  return {
    Virtuoso: React.forwardRef<unknown, Record<string, unknown>>(
      function MockVirtuoso(props) {
        customScrollParents.push(
          props.customScrollParent as HTMLElement | undefined
        );
        return <div data-testid="mock-virtuoso" />;
      }
    ),
    VirtuosoHandle: class {},
  };
});

afterEach(() => {
  customScrollParents.length = 0;
  cleanup();
});

// Minimal Map-backed ComponentStateHooks; RecordTree uses
// useCollapsibleIds + useVirtuosoState which both consume this context.
function makeStateHooks() {
  const store = new Map<string, unknown>();
  const k = (id: string, prop: string) => `${id}::${prop}`;
  return {
    useValue: (id: string, prop: string) => store.get(k(id, prop)),
    useSetValue: () => (id: string, prop: string, v: unknown) => {
      store.set(k(id, prop), v);
    },
    useRemoveValue: () => (id: string, prop: string) => {
      store.delete(k(id, prop));
    },
    useEntries: () => undefined,
    useRemoveAll: () => () => {},
    useRemoveByPrefix: () => () => {},
  };
}

const Wrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ComponentStateProvider hooks={makeStateHooks()}>
    {children}
  </ComponentStateProvider>
);

describe("RecordTree — customScrollParent state resolution (#90)", () => {
  it("renders without virtualization when no scrollRef is passed", () => {
    const { container, queryByTestId } = render(
      <Wrap>
        <RecordTree id="t1" record={{ a: 1, b: "two" }} />
      </Wrap>
    );
    expect(queryByTestId("mock-virtuoso")).toBeNull();
    expect(container.textContent).toContain("a");
    expect(container.textContent).toContain("b");
  });

  it("forwards the resolved scroll parent to Virtuoso (not undefined) after mount", async () => {
    // The bug: pre-fix, the very first commit passed
    // `customScrollParent={undefined}` because scrollRef.current was null
    // during render. The fix synchronises the ref target into local state
    // in a post-mount effect, so a re-render lands with the real element.
    let parentEl: HTMLDivElement | null = null;
    const Host: React.FC = () => {
      const scrollRef = useRef<HTMLDivElement | null>(null);
      return (
        <div
          ref={(el) => {
            scrollRef.current = el;
            parentEl = el;
          }}
          data-testid="scroll-parent"
        >
          <RecordTree id="t2" record={{ a: 1 }} scrollRef={scrollRef} />
        </div>
      );
    };

    render(
      <Wrap>
        <Host />
      </Wrap>
    );

    // After the effect runs, Virtuoso must have been re-rendered with the
    // actual parent element — not undefined.
    await waitFor(() => {
      expect(customScrollParents.at(-1)).toBe(parentEl);
      expect(parentEl).not.toBeNull();
    });
  });

  it("passes undefined when scrollRef itself is omitted from the virtualized path", () => {
    // Sanity: when no scrollRef is given, the unvirtualized branch is taken
    // and Virtuoso isn't rendered at all (no entries captured).
    render(
      <Wrap>
        <RecordTree id="t3" record={{ a: 1 }} />
      </Wrap>
    );
    expect(customScrollParents.length).toBe(0);
  });
});
