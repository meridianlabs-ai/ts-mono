// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testSwarmEvent } from "@tsmono/inspect-common/testing";
import type { Event, SwarmEvent } from "@tsmono/inspect-common/types";
import {
  ComponentNavigationProvider,
  FindTargetProvider,
  untrustedText,
  type FindTarget,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, ResizeObserverStub } from "@tsmono/react/testing";

import { findAllMatches } from "./search/sampleSearch";
import { SwarmEventView } from "./SwarmEventView";
import { EventNode } from "./types";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const renderView = (event: SwarmEvent, target: FindTarget | null = null) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <FindTargetProvider value={target}>
          <SwarmEventView eventNode={new EventNode("swarm-1", event, 0)} />
        </FindTargetProvider>
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );

// The data panel is truncated by an inline max-height while collapsed.
const panelExpanded = (container: HTMLElement): boolean => {
  const content = container.querySelector(
    '[data-expandable-panel="true"]'
  )?.firstElementChild;
  return content instanceof HTMLElement && content.style.maxHeight === "";
};

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

  it.each(['"reason": "needle"', '"kind": "final"'])(
    "opens its data panel on %s, which search counts",
    async (term) => {
      const event = testSwarmEvent({
        uuid: "u-1",
        kind: "final",
        data: { version: 1, reason: "needle" },
      });
      const events: Event[] = [event];
      expect(
        findAllMatches(events, term, new Map([["u-1", "row"]]))
      ).toHaveLength(1);

      const { container } = renderView(event, { term, eventId: "u-1" });
      await waitFor(() => {
        expect(panelExpanded(container)).toBe(true);
      });
      expect(container.querySelector("code")?.textContent).toContain(term);
    }
  );
});
