// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testSwarmEvent } from "@tsmono/inspect-common/testing";
import type { SwarmEvent } from "@tsmono/inspect-common/types";
import {
  ComponentNavigationProvider,
  untrustedText,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, ResizeObserverStub } from "@tsmono/react/testing";

import { SwarmEventView } from "./SwarmEventView";
import { EventNode } from "./types";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const renderView = (event: SwarmEvent) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <SwarmEventView eventNode={new EventNode("swarm-1", event, 0)} />
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );

afterEach(() => {
  cleanup();
});

describe("SwarmEventView", () => {
  it("renders an unknown kind with its member and data", () => {
    renderView(
      testSwarmEvent({
        kind: "not_a_known_kind",
        member: "counter-5",
        data: { version: 7, note: "**not markdown**" },
      })
    );
    expect(screen.getByText("Swarm:")).toBeDefined();
    expect(screen.getByText("not_a_known_kind")).toBeDefined();
    expect(screen.getByText("counter-5")).toBeDefined();
    expect(screen.getByText(/"note": "\*\*not markdown\*\*"/)).toBeDefined();
  });

  it("reveals hidden characters in kind and member", () => {
    const { container } = renderView(
      testSwarmEvent({ kind: "kind-\u202E", member: "member-\u200B" })
    );
    expect(screen.getByText(untrustedText("kind-\u202E"))).toBeDefined();
    expect(screen.getByText(untrustedText("member-\u200B"))).toBeDefined();
    expect(container.textContent).not.toMatch(/[\u202E\u200B]/);
  });
});
