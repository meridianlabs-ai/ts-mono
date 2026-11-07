// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeEvent } from "@tsmono/inspect-common/normalize";
import type { InterruptEvent } from "@tsmono/inspect-common/types";
import { ComponentNavigationProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, ResizeObserverStub } from "@tsmono/react/testing";

import { InterruptEventView } from "./InterruptEventView";
import { EventNode } from "./types";

// Built from raw JSON so out-of-enum values reach the view as a log would.
const interruptEvent = (fields: Record<string, string>): InterruptEvent => {
  const event = normalizeEvent({
    event: "interrupt",
    timestamp: new Date(0).toISOString(),
    working_start: 0,
    ...fields,
  });
  if (event?.event !== "interrupt") throw new Error("not an interrupt event");
  return event;
};

const renderView = (event: InterruptEvent) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <InterruptEventView
          eventNode={new EventNode("interrupt-1", event, 0)}
        />
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );

describe("InterruptEventView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("describes a known source and interruption point", () => {
    renderView(interruptEvent({ source: "limit", interrupted: "tool_call" }));
    expect(screen.getByText(/Interrupted by limit/)).toBeDefined();
    expect(screen.getByText("during tool execution")).toBeDefined();
  });

  it.each(["__proto__", "constructor"])(
    "renders an interrupt whose source and interrupted are %s",
    (value) => {
      renderView(interruptEvent({ source: value, interrupted: value }));
      expect(screen.getByText(/Interrupted/)).toBeDefined();
    }
  );
});
