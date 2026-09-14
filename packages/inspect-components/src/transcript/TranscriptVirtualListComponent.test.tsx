// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testInfoEvent,
  testLoggerEvent,
  testSpanBeginEvent,
} from "@tsmono/inspect-common/testing";
import { ExtendedFindProvider } from "@tsmono/react/components";
import {
  ComponentStateProvider,
  type ComponentStateHooks,
} from "@tsmono/react/state";
import { makeReactiveStateHooks } from "@tsmono/react/testing";
import type { VirtualListHandle } from "@tsmono/react/virtual";

import {
  renderTranscriptFooter,
  TranscriptVirtualList,
} from "./TranscriptVirtualListComponent";
import { EventNode } from "./types";

afterEach(cleanup);

const node = (id: string, depth: number): EventNode =>
  new EventNode(
    id,
    testInfoEvent({ uuid: id, timestamp: "2026-01-01T00:00:00Z" }),
    depth
  );

// A focus slice starting inside an agent span: rows keep their ABSOLUTE
// transcript depths (2 and 3 here).
const nestedSlice = [node("m1", 2), node("t1", 3)];

const stateHooks: ComponentStateHooks = {
  useValue: () => undefined,
  useSetValue: () => () => {},
  useRemoveValue: () => () => {},
  useEntries: () => undefined,
  useRemoveAll: () => () => {},
  useRemoveByPrefix: () => () => {},
};

const renderList = (relativeIndent: boolean) =>
  render(
    <ComponentStateProvider hooks={stateHooks}>
      <TranscriptVirtualList
        id="test"
        listHandle={createRef<VirtualListHandle | null>()}
        eventNodes={nestedSlice}
        disableVirtualization={true}
        relativeIndent={relativeIndent}
      />
    </ComponentStateProvider>
  );

describe("TranscriptVirtualList relativeIndent", () => {
  it("indents relative to the first row, so a nested slice renders flush", () => {
    const { container } = renderList(true);
    expect(container.querySelector<HTMLElement>("#m1")?.style.paddingLeft).toBe(
      "0em"
    );
    expect(container.querySelector<HTMLElement>("#t1")?.style.paddingLeft).toBe(
      "0.7em"
    );
  });

  it("keeps absolute transcript depths without the flag", () => {
    const { container } = renderList(false);
    expect(
      parseFloat(
        container.querySelector<HTMLElement>("#m1")?.style.paddingLeft ?? "0"
      )
    ).toBeCloseTo(1.7);
  });
});

// The finish-scroll behavior under test only reproduces with a store that
// actually re-renders on setProperty, hence the reactive fake from
// @tsmono/react/testing.
describe("TranscriptVirtualList finish scroll-to-top", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollTo = function () {};
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const mountLive = (scrollToTopOnFinish: boolean | undefined) => {
    const scrollRef = createRef<HTMLDivElement>();
    const hooks = makeReactiveStateHooks();
    const nodes = [node("e1", 0), node("e2", 0)];
    const view = (running: boolean) => (
      <ComponentStateProvider hooks={hooks}>
        <ExtendedFindProvider>
          <div ref={scrollRef}>
            <TranscriptVirtualList
              id="finish-test"
              listHandle={createRef<VirtualListHandle | null>()}
              eventNodes={nodes}
              scrollRef={scrollRef}
              running={running}
              scrollToTopOnFinish={scrollToTopOnFinish}
            />
          </div>
        </ExtendedFindProvider>
      </ComponentStateProvider>
    );
    const rendered = render(view(true));
    return {
      scrollRef,
      finish: () => rendered.rerender(view(false)),
      unmount: rendered.unmount,
    };
  };

  it("scrolls to top on a successful finish (default)", () => {
    const { scrollRef, finish, unmount } = mountLive(undefined);
    finish();
    const scrollTo = vi.fn();
    scrollRef.current!.scrollTo = scrollTo;
    vi.advanceTimersByTime(200);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    unmount();
  });

  it("stays put when the host reports an unsuccessful finish (error/cancelled)", () => {
    // An errored or cancelled run renders its error panel at the bottom,
    // exactly where the user is looking — never yank them to the top. The
    // host passes scrollToTopOnFinish={false} for those finishes.
    const { scrollRef, finish, unmount } = mountLive(false);
    finish();
    const scrollTo = vi.fn();
    scrollRef.current!.scrollTo = scrollTo;
    vi.advanceTimersByTime(200);
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    unmount();
  });
});

describe("renderTranscriptFooter", () => {
  afterEach(() => cleanup());

  it("shows Loading events when backfilling, regardless of tools-running", () => {
    render(renderTranscriptFooter({ backfilling: true, toolsRunning: true }));
    expect(screen.getByText("Loading events")).toBeDefined();
    expect(screen.queryByText("running")).toBeNull();
  });

  it("shows the running indicator when live and tools are running", () => {
    render(renderTranscriptFooter({ backfilling: false, toolsRunning: true }));
    expect(screen.getByText("running")).toBeDefined();
    expect(screen.queryByText("Loading events")).toBeNull();
  });

  it("renders nothing when live and idle", () => {
    const { container } = render(
      renderTranscriptFooter({ backfilling: false, toolsRunning: false })
    );
    expect(container.firstChild).toBeNull();
  });
});

// Event labels are keyed by the log's event uuid. A uuid that names an
// Object.prototype member must read as "no label", not as the builtin.
describe("TranscriptVirtualList event labels", () => {
  const renderLabeled = (nodes: EventNode[]) =>
    render(
      <ComponentStateProvider hooks={stateHooks}>
        <TranscriptVirtualList
          id="labels-test"
          listHandle={createRef<VirtualListHandle | null>()}
          eventNodes={nodes}
          disableVirtualization={true}
          eventNodeContext={{ eventLabels: { labeled: "[E1]" } }}
        />
      </ComponentStateProvider>
    );

  it("shows the label of a cited event", () => {
    renderLabeled([node("labeled", 0)]);
    expect(screen.getAllByText("E1")).toHaveLength(1);
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "renders an event with uuid %s unlabeled",
    (uuid) => {
      const { container } = renderLabeled([node("labeled", 0), node(uuid, 0)]);
      expect(container.querySelector(`[id="${uuid}"]`)).not.toBeNull();
      expect(screen.getAllByText("E1")).toHaveLength(1);
    }
  );
});

describe("TranscriptVirtualList evidence selection", () => {
  // A logger row renders through EventRow rather than EventPanel — both
  // header styles must offer the checkbox.
  // Spans are structure, not evidence: no checkbox on the span_begin row.
  const selectableSlice = [
    new EventNode(
      "s1",
      testSpanBeginEvent({ uuid: "s1", timestamp: "2026-01-01T00:00:00Z" }),
      1
    ),
    ...nestedSlice,
    new EventNode(
      "l1",
      testLoggerEvent({ uuid: "l1", timestamp: "2026-01-01T00:00:00Z" }),
      2
    ),
  ];
  const renderSelectable = (onToggle: (id: string, extend: boolean) => void) =>
    render(
      <ComponentStateProvider hooks={stateHooks}>
        <TranscriptVirtualList
          id="selection-test"
          listHandle={createRef<VirtualListHandle | null>()}
          eventNodes={selectableSlice}
          disableVirtualization={true}
          selection={{ selectedIds: new Set(["m1"]), onToggle }}
        />
      </ComponentStateProvider>
    );

  it("renders no checkboxes while selection mode is off", () => {
    renderList(false);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("renders a header checkbox per event row reflecting the selection", () => {
    renderSelectable(() => {});
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(boxes[0]?.getAttribute("aria-checked")).toBe("true");
    expect(boxes[1]?.getAttribute("aria-checked")).toBe("false");
    expect(boxes[2]?.getAttribute("aria-checked")).toBe("false");
  });

  it("reports plain and shift clicks with the row id", () => {
    const onToggle = vi.fn();
    renderSelectable(onToggle);
    const [, unselected, loggerRow] = screen.getAllByRole("checkbox");
    fireEvent.click(unselected!);
    expect(onToggle).toHaveBeenLastCalledWith("t1", false);
    fireEvent.click(unselected!, { shiftKey: true });
    expect(onToggle).toHaveBeenLastCalledWith("t1", true);
    fireEvent.click(loggerRow!);
    expect(onToggle).toHaveBeenLastCalledWith("l1", false);
  });
});
