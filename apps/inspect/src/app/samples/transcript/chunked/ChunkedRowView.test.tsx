// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testStateEvent } from "@tsmono/inspect-common/testing";
import { ResizeObserverStub } from "@tsmono/react/testing";

import {
  ComponentProviders,
  startTestApp,
  stopTestApp,
} from "../../../../test/testApp";

import { ChunkedRowView } from "./ChunkedRowView";

const diffOnlyRow = {
  kind: "event" as const,
  ordinal: 0,
  depth: 0,
  ev: testStateEvent({
    uuid: "state-1",
    changes: [{ op: "add", path: "/count", value: 1, replaced: null }],
  }),
};

const renderRow = (collapsedOverrides?: Record<string, boolean>) =>
  render(
    <ComponentProviders>
      <ChunkedRowView
        row={diffOnlyRow}
        eventCallbacks={{
          getCollapsed: (id) => collapsedOverrides?.[id] ?? false,
          onCollapse: () => {},
        }}
        collapsedOverrides={collapsedOverrides}
      />
    </ComponentProviders>
  );

const stateToggle = () =>
  screen.getByRole("button", { name: /(Expand|Collapse) State Updated/ });

describe("ChunkedRowView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    startTestApp();
  });
  afterEach(async () => {
    cleanup();
    await stopTestApp();
    vi.unstubAllGlobals();
  });

  it("starts a diff-only state event collapsed", () => {
    renderRow();
    expect(stateToggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a recorded expand", () => {
    renderRow({ "state-1": false });
    expect(stateToggle().getAttribute("aria-expanded")).toBe("true");
  });
});
