// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testCommunicationEvent } from "@tsmono/inspect-common/testing";
import type {
  CommunicationEvent,
  CommunicationRecord,
} from "@tsmono/inspect-common/types";
import {
  ComponentNavigationProvider,
  FindTargetProvider,
  untrustedText,
  type FindTarget,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  makeReactiveStateHooks,
  ResizeObserverStub,
} from "@tsmono/react/testing";

import { CommunicationEventView } from "./CommunicationEventView";
import { findAllMatches } from "./search/sampleSearch";
import { EventNode } from "./types";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const record = (
  overrides: Partial<CommunicationRecord> = {}
): CommunicationRecord => ({
  id: "w-1",
  kind: "create",
  sender: "counter-6",
  to: [],
  recipients: [],
  ...overrides,
});

const sent = (
  overrides: Partial<CommunicationRecord> = {},
  rejected?: { control: string; reason: string }
) =>
  testCommunicationEvent({
    kind: "sent",
    agent: "counter-6",
    channel: "shared_memory",
    record_ids: ["w-1"],
    send: { record: record(overrides), rejected },
  });

const renderView = (event: CommunicationEvent) => {
  const hooks = makeReactiveStateHooks();
  const node = new EventNode("comm-1", event, 0);
  const tree = (target: FindTarget | null) => (
    <ComponentStateProvider hooks={hooks}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <FindTargetProvider value={target}>
          <CommunicationEventView eventNode={node} />
        </FindTargetProvider>
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );
  const view = render(tree(null));
  return {
    ...view,
    find: (target: FindTarget | null) => view.rerender(tree(target)),
  };
};

const expanded = () => screen.getByRole("button").getAttribute("aria-expanded");

// The event's JSON, mounted (hidden while collapsed) so find can see it.
const jsonElement = () => screen.getByText(/"agent": /);
const json = () => jsonElement().textContent;
const jsonShown = () => jsonElement().closest("[hidden]") === null;

// The line after the agent's name.
const line = () => screen.getByRole("button").textContent;

afterEach(() => {
  cleanup();
});

describe("CommunicationEventView", () => {
  it("renders a send with its addresses and the first line of its content", () => {
    renderView(sent({ to: ["b", "c"], content: "hello there\nsecond line" }));
    expect(screen.getByText("counter-6")).toBeDefined();
    expect(line()).toBe("→ shared_memory: create (w-1) to b, c hello there");
  });

  it("renders a refused send with its control and reason", () => {
    renderView(
      sent({ content: "spam" }, { control: "rate", reason: "too many writes" })
    );
    expect(line()).toBe(
      "→ shared_memory: create (w-1) refused (rate) too many writes"
    );
  });

  it("renders a delivery with its order and recipients", () => {
    renderView(
      testCommunicationEvent({
        kind: "delivered",
        agent: "counter-6",
        channel: "shared_memory",
        record_ids: ["w-1"],
        delivery: { recipients: ["b", "c"], seq: 1 },
      })
    );
    expect(line()).toBe("→ shared_memory: delivered w-1 (#1) to b, c");
  });

  it.each([
    [{ lines: "3-8", deleted: false }, "read w-4 (lines 3-8)"],
    [{ lines: null, deleted: true }, "read w-4 (deleted)"],
    [{ lines: null, deleted: false }, "read w-4"],
  ])("renders a read of %o", (file, expected) => {
    renderView(
      testCommunicationEvent({
        kind: "read",
        agent: "counter-2",
        channel: "shared_memory",
        record_ids: ["w-4"],
        data: { listing: false, files: [{ file: "f-1", ...file }] },
      })
    );
    expect(line()).toBe(`← shared_memory: ${expected}`);
  });

  it("renders a listing with its file count", () => {
    renderView(
      testCommunicationEvent({
        kind: "read",
        channel: "shared_memory",
        record_ids: ["w-1", "w-2"],
        data: { listing: true, files: [{}, {}, {}] },
      })
    );
    expect(line()).toBe("← shared_memory: listed 3 files");
  });

  it("renders a read of no records", () => {
    renderView(
      testCommunicationEvent({ kind: "read", channel: "shared_memory" })
    );
    expect(line()).toBe("← shared_memory: read (nothing)");
  });

  it("renders a wait with its duration, channels and outcome", () => {
    renderView(
      testCommunicationEvent({
        kind: "waited",
        agent: "counter-5",
        channel: null,
        wait: { channels: ["shared_memory"], outcome: "news", duration: 4.2 },
      })
    );
    expect(screen.getByText("counter-5")).toBeDefined();
    expect(line()).toBe("waited 4.2s on shared_memory: news");
  });

  it("marks an agent acting through a subagent", () => {
    renderView(testCommunicationEvent({ agent: "counter-2", nested: true }));
    expect(screen.getByText("counter-2 (subagent)")).toBeDefined();
  });

  it("renders Markdown and HTML in content as text", () => {
    const { container } = renderView(
      sent({ content: "**bold** <b>tag</b> [link](https://example.com)" })
    );
    expect(line()).toContain("**bold** <b>tag</b> [link](https://example.com)");
    expect(container.querySelector("strong, b, a")).toBeNull();
  });

  it("expands the whole event as JSON when the line is clicked", () => {
    renderView(sent({ content: "hello" }, { control: "rate", reason: "why" }));
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(jsonShown()).toBe(false);

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(jsonShown()).toBe(true);
    expect(json()).toContain('"sender": "counter-6"');
  });

  it("reveals hidden characters in content and refusal reasons", () => {
    const hostile = "safe\u202Espoof\u200B";
    renderView(
      sent({ content: hostile }, { control: "rate", reason: hostile })
    );
    expect(line()).not.toMatch(/[\u202E\u200B]/);
    expect(line()).toBe(
      `→ shared_memory: create (w-1) refused (rate) ${untrustedText(hostile)}`
    );

    cleanup();
    renderView(sent({ content: hostile }));
    expect(line()).toBe(
      `→ shared_memory: create (w-1) ${untrustedText(hostile)}`
    );
  });

  it("ends the preview at a CRLF line break in content and refusal reasons", () => {
    renderView(
      sent(
        { content: "hello\r\nworld" },
        { control: "rate", reason: "too many\r\nwrites" }
      )
    );
    expect(line()).toBe(
      "→ shared_memory: create (w-1) refused (rate) too many"
    );

    cleanup();
    renderView(sent({ content: "hello\r\nworld" }));
    expect(line()).toBe("→ shared_memory: create (w-1) hello");
  });

  it("keeps the marker for a lone CR in the preview", () => {
    renderView(sent({ content: "hello\rworld" }));
    expect(untrustedText("hello\rworld")).not.toBe("hello\rworld");
    expect(line()).toBe(
      `→ shared_memory: create (w-1) ${untrustedText("hello\rworld")}`
    );
  });

  it.each([
    ["a later line", { content: "first line\nneedle" }, undefined],
    [
      "text past the preview",
      { content: `${"x".repeat(250)}needle` },
      undefined,
    ],
    [
      "a second occurrence",
      { content: "needle first\nneedle second" },
      undefined,
    ],
    [
      "refused content whose reason also matches",
      { content: "needle" },
      { control: "rate", reason: "too many needles" },
    ],
  ])("opens when find lands on %s", (_, overrides, rejected) => {
    const event = sent(overrides, rejected);
    const { find } = renderView(event);
    find({ term: "NEEDLE", eventId: "comm-1" });
    expect(expanded()).toBe("true");
    expect(json()).toContain(JSON.stringify(event.send?.record.content));
  });

  it.each([
    ["the event's target", "comm-1"],
    ["FindBand's term-only target", ""],
  ])("opens on a quoted term for %s", (_, eventId) => {
    const { find } = renderView(
      sent({ content: "needle" }, { control: "rate", reason: "too many" })
    );
    find({ term: '"needle"', eventId });
    expect(expanded()).toBe("true");
    expect(jsonShown()).toBe(true);
  });

  it("follows find from the event target to the term-only target, keeping the stored state", () => {
    const { find } = renderView(sent({ content: "first\nneedle" }));
    expect(expanded()).toBe("false");

    find({ term: "needle", eventId: "comm-1" });
    expect(expanded()).toBe("true");
    expect(jsonShown()).toBe(true);

    find({ term: "needle", eventId: "" });
    expect(expanded()).toBe("true");

    find({ term: "no match", eventId: "" });
    expect(expanded()).toBe("false");
    expect(jsonShown()).toBe(false);

    find(null);
    expect(expanded()).toBe("false");
  });

  it.each([
    ['"content": "needle"', 1, "true"],
    ['"content":"needle"', 0, "false"],
  ])("search and find agree on %s", (term, count, opened) => {
    const event = {
      ...sent({ content: "needle" }, { control: "rate", reason: "too many" }),
      uuid: "u-1",
    };
    expect(
      findAllMatches([event], term, new Map([["u-1", "row"]]))
    ).toHaveLength(count);

    const { find } = renderView(event);
    find({ term, eventId: "u-1" });
    expect(expanded()).toBe(opened);
  });
});
