// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolEvent } from "@tsmono/inspect-common/types";
import { ComponentNavigationProvider } from "@tsmono/react/components";
import {
  ComponentStateHooks,
  ComponentStateProvider,
} from "@tsmono/react/state";

import { ToolEventView } from "./ToolEventView";
import type { EventNode } from "./types";

const stateHooks: ComponentStateHooks = {
  useValue: (_id, _prop, defaultValue) => defaultValue,
  useSetValue: () => () => {},
  useRemoveValue: () => () => {},
  useEntries: () => undefined,
  useRemoveAll: () => () => {},
  useRemoveByPrefix: () => () => {},
};

function makeNode(
  fn: string,
  args: Record<string, unknown>
): EventNode<ToolEvent> {
  return {
    id: "tool-1",
    children: [],
    event: {
      event: "tool",
      id: "tool-call-1",
      function: fn,
      arguments: args,
      result: "done",
      view: null,
      error: null,
      pending: false,
      timestamp: new Date(0).toISOString(),
      working_start: 0,
      span_id: null,
      uuid: "tool-1",
      metadata: null,
      events: [],
    },
  } as unknown as EventNode<ToolEvent>;
}

const renderView = (fn: string, args: Record<string, unknown>) =>
  render(
    <ComponentStateProvider hooks={stateHooks}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <ToolEventView eventNode={makeNode(fn, args)} childNodes={[]} />
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("ToolEventView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders long args of an unknown tool in an expandable input zone", () => {
    // A tool without a dedicated input descriptor whose args are far too long
    // for the one-line header summary (the reported case: thousands of chars).
    const longText = `${"x".repeat(3000)} END_OF_ARGS`;
    const { container } = renderView("my_custom_tool", { payload: longText });

    const input = container.querySelector(".tool-call-input");
    expect(input).not.toBeNull();
    expect(input!.textContent).toContain("END_OF_ARGS");
    // The args body lives inside an expandable panel so it can collapse/expand.
    const panel = container.querySelector("[data-expandable-panel]");
    expect(panel?.textContent).toContain("END_OF_ARGS");
  });

  it("renders multi-line object args of an unknown tool in the input zone", () => {
    const { container } = renderView("my_custom_tool", {
      config: { alpha: "a".repeat(200), beta: "b".repeat(200) },
    });

    const input = container.querySelector(".tool-call-input");
    expect(input).not.toBeNull();
    expect(input!.textContent).toContain("alpha");
    expect(input!.textContent).toContain("beta");
  });

  it("keeps a small object arg on the header line only", () => {
    // formatArg pretty-prints object/array values across multiple lines, but
    // that formatting artifact alone must not promote args to the input zone.
    const { container } = renderView("my_custom_tool", {
      coordinate: [100, 200],
    });

    expect(container.querySelector(".tool-call-input")).toBeNull();
    expect(container.textContent).toContain("coordinate: [ 100, 200 ]");
  });

  it("keeps short args of an unknown tool on the header line only", () => {
    const { container } = renderView("my_custom_tool", { path: "foo.txt" });

    expect(container.querySelector(".tool-call-input")).toBeNull();
    expect(container.textContent).toContain('path: "foo.txt"');
  });

  it("still renders a known tool's input arg in the input zone", () => {
    const { container } = renderView("bash", { cmd: "echo hello" });

    const input = container.querySelector(".tool-call-input");
    expect(input).not.toBeNull();
    expect(input!.textContent).toContain("echo hello");
  });
});
