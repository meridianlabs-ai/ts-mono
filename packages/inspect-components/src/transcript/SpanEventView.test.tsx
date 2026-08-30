// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testSpanBeginEvent,
  testStepEvent,
} from "@tsmono/inspect-common/testing";
import type { SpanBeginEvent, StepEvent } from "@tsmono/inspect-common/types";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { SpanEventView } from "./SpanEventView";
import { kSandboxSignalName } from "./transform/fixups";
import { EventNode } from "./types";

const renderView = (event: SpanBeginEvent | StepEvent) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <SpanEventView
            eventNode={new EventNode("n-1", event, 0)}
            childNodes={[]}
          />
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("SpanEventView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a span_begin event with the span class and type-prefixed title", () => {
    const { container } = renderView(
      testSpanBeginEvent({ name: "my_agent", type: "agent", span_id: "s1" })
    );
    expect(screen.getByText("agent: my_agent")).toBeTruthy();
    expect(container.querySelector(".transcript-span")).not.toBeNull();
    expect(container.querySelector(".transcript-step")).toBeNull();
  });

  it("renders a legacy step event with the step class", () => {
    const { container } = renderView(
      testStepEvent({ name: "my_step", type: null })
    );
    expect(screen.getByText("Step: my_step")).toBeTruthy();
    expect(container.querySelector(".transcript-step")).not.toBeNull();
    expect(container.querySelector(".transcript-span")).toBeNull();
  });

  it("recognizes the sandbox signal in span_id for spans and name for steps", () => {
    renderView(
      testSpanBeginEvent({
        name: "whatever",
        type: null,
        span_id: kSandboxSignalName,
      })
    );
    expect(screen.getByText("Sandbox Events")).toBeTruthy();
    cleanup();

    renderView(testStepEvent({ name: kSandboxSignalName, type: null }));
    expect(screen.getByText("Sandbox Events")).toBeTruthy();
  });
});
