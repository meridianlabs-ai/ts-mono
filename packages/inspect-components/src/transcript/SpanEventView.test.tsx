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
import {
  makeStateHooks,
  ResizeObserverStub,
  testIcons,
} from "@tsmono/react/testing";

import { SpanEventView } from "./SpanEventView";
import { eventNode } from "./testHelpers";
import { kSandboxSignalName } from "./transform/fixups";

const renderView = (event: SpanBeginEvent | StepEvent) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <SpanEventView eventNode={eventNode(event)} childNodes={[]} />
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

describe("SpanEventView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a span_begin event with a type-prefixed title", () => {
    renderView(
      testSpanBeginEvent({ name: "my_agent", type: "agent", span_id: "s1" })
    );
    expect(screen.getByText("agent: my_agent")).toBeTruthy();
  });

  it("renders a legacy step event with the Step-prefixed title", () => {
    renderView(testStepEvent({ name: "my_step", type: null }));
    expect(screen.getByText("Step: my_step")).toBeTruthy();
  });

  it("names the sandbox span and the sandbox legacy step", () => {
    renderView(
      testSpanBeginEvent({
        name: kSandboxSignalName,
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
