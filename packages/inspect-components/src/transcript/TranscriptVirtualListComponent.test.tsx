import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testInfoEvent } from "@tsmono/inspect-common/testing";
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
        <>
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
        </>
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
