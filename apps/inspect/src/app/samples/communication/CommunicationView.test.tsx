// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  makeReactiveStateHooks,
  ResizeObserverStub,
} from "@tsmono/react/testing";

import { CommunicationView } from "./CommunicationView";
import { kLongMessage, swarmCommunication, swarmSent } from "./swarmFixture";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const renderView = (events: Event[] = swarmCommunication()) =>
  render(
    <ComponentStateProvider hooks={makeReactiveStateHooks()}>
      <CommunicationView id="test" events={events} />
    </ComponentStateProvider>
  );

const rows = () => within(screen.getByRole("list")).getAllByRole("listitem");
const message = (name: string) => screen.getByRole("article", { name });

const choose = (menu: RegExp, value: string) => {
  fireEvent.click(screen.getByRole("button", { name: menu }));
  fireEvent.click(screen.getByRole("button", { name: value }));
};

afterEach(() => {
  cleanup();
});

describe("CommunicationView", () => {
  it("shows a send as a message with its delivery joined, not repeated", () => {
    renderView();
    const first = message("message from alice");
    expect(within(first).getByText("alice")).toBeDefined();
    expect(first.textContent).toContain("→ bob");
    expect(first.textContent).toContain("messages · message · m-1");
    expect(first.textContent).toContain("Delivered (#1) to bob");
    // The delivery has no row of its own, so the content shows once.
    expect(screen.getAllByText(/please check a\.md/)).toHaveLength(1);
  });

  it("keeps the whole of long content, collapsed", () => {
    renderView();
    const content = within(message("message from alice")).getByText(
      /please check a\.md/
    );
    expect(content.textContent).toBe(kLongMessage);
  });

  it("shows a reply with the message it answers", () => {
    renderView();
    expect(message("message from bob").textContent).toContain(
      "In reply to m-1 from alice"
    );
  });

  it("shows a refusal with its control and reason, and no delivery", () => {
    renderView();
    const refused = message("Refused message from alice");
    expect(refused.textContent).toContain(
      "Refused (rate): rate limit: retry in 3600 s"
    );
    expect(refused.textContent).toContain("(to all)");
    expect(refused.textContent).not.toContain("Delivered");
  });

  it("shows reads and waits on one line each", () => {
    renderView();
    const lines = rows().map((row) => row.textContent);
    expect(lines).toContainEqual(
      expect.stringContaining("bobwaited 0.5s on messages, shared_memory: news")
    );
    expect(lines).toContainEqual(
      expect.stringContaining("bob← messages: read m-1")
    );
  });

  it("marks a subagent's send", () => {
    renderView([
      { ...swarmSent("s", 1, { id: "m-1", sender: "alice" }), nested: true },
    ]);
    expect(screen.getByText("alice (subagent)")).toBeDefined();
  });

  it("filters by agent and by channel", () => {
    renderView();
    expect(rows()).toHaveLength(8);

    choose(/Agent: All/, "alice");
    expect(screen.getByRole("button", { name: /Agent: alice/ })).toBeDefined();
    // alice's sends and wait, and bob's reply to her.
    expect(rows()).toHaveLength(5);
    expect(screen.getByText("5 of 8 events")).toBeDefined();

    choose(/Channel: All/, "shared_memory");
    expect(rows()).toHaveLength(2);
    expect(
      screen.queryByRole("article", { name: "message from bob" })
    ).toBeNull();

    choose(/Agent: alice/, "All");
    choose(/Channel: shared_memory/, "All");
    expect(rows()).toHaveLength(8);
  });
});
