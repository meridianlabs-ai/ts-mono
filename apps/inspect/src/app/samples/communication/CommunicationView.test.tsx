// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeEvents } from "@tsmono/inspect-common/normalize";
import type { Event } from "@tsmono/inspect-common/types";
import { fmtClock } from "@tsmono/inspect-components/usage";
import { untrustedText } from "@tsmono/react/components";
import { ResizeObserverStub } from "@tsmono/react/testing";

import { CommunicationView } from "./CommunicationView";
import {
  kLongMessage,
  swarmCommunication,
  swarmSent,
  swarmWaited,
} from "./swarmFixture";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// jsdom has no layout, and the grid's virtualizer renders only the rows that
// fit its scroll element, so give every element a size.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1600);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderView = (events: Event[] = swarmCommunication()) =>
  render(<CommunicationView events={events} />);

const grid = () => screen.getByRole("grid", { name: "Communication" });

/** Each body row as its cells' text, keyed by column header. */
const rows = (): Record<string, string>[] => {
  const headers = within(grid())
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
  return within(grid())
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        within(row)
          .getAllByRole("gridcell")
          .map((cell, index) => [headers[index] ?? "", cell.textContent])
      )
    );
};

const rowWith = (column: string, text: string) => {
  const row = rows().find((r) => r[column] === text);
  expect(row).toBeDefined();
  return row ?? {};
};

/** Click the row whose Id cell holds `id` and that is a send. */
const select = (id: string) => {
  const index = rows().findIndex((r) => r.Id === id && r.Event === "sent");
  const row = within(grid()).getAllByRole("row")[index + 1];
  expect(row).toBeDefined();
  if (row) fireEvent.click(row);
};

const selected = () => screen.getByRole("region", { name: "Selected row" });

describe("CommunicationView", () => {
  it("shows a send as a row with its delivery joined, not repeated", () => {
    renderView();
    // Deliveries e2, e5 and e9 join their sends.
    expect(rows()).toHaveLength(8);
    expect(rowWith("Id", "m-1")).toMatchObject({
      Agent: "alice",
      Event: "sent",
      Channel: "messages",
      Kind: "message",
      To: "bob",
      "Delivered to": "bob",
      Status: "Delivered",
    });
  });

  it("shows whom a shared-memory write was news to", () => {
    renderView();
    expect(rowWith("Id", "w-1")).toMatchObject({
      To: "",
      "Delivered to": "bob",
    });
    select("w-1");
    expect(selected().textContent).toContain("Delivered (#2) · notified bob");
  });

  it("shows the selected row in full", () => {
    renderView();
    expect(selected().textContent).toBe("Select a row to show it in full.");
    select("m-1");
    const message = within(selected()).getByRole("article", {
      name: "message from alice",
    });
    expect(message.textContent).toContain("Delivered (#1) to bob");
    expect(within(message).getByText(/please check a\.md/).textContent).toBe(
      kLongMessage
    );
  });

  it("caps a long preview with an ellipsis, not the selected content", () => {
    const long = "x".repeat(1000);
    renderView([
      swarmSent("s", 1, { id: "m-1", sender: "alice", content: long }),
    ]);
    expect(rowWith("Id", "m-1").Content).toBe(`${"x".repeat(300)}…`);
    select("m-1");
    expect(within(selected()).getByText(long)).toBeDefined();
  });

  it("shows a reply with the message it answers", () => {
    renderView();
    expect(rowWith("Id", "m-3")["Reply to"]).toBe("m-1 from alice");
  });

  it("shows a refusal with its control and reason, and no delivery", () => {
    renderView();
    expect(rowWith("Id", "m-2")).toMatchObject({
      Status: "Refused (rate): rate limit: retry in 3600 s",
      "Delivered to": "",
    });
    select("m-2");
    const refused = within(selected()).getByRole("article", {
      name: "Refused message from alice",
    });
    expect(refused.textContent).toContain(
      "Refused (rate): rate limit: retry in 3600 s"
    );
    expect(refused.textContent).toContain("(to all)");
  });

  it("shows reads and waits as rows of their own", () => {
    renderView();
    expect(
      rowWith("Content", "waited 0.5s on messages, shared_memory: news")
    ).toMatchObject({
      Agent: "bob",
      Event: "waited",
      Channel: "messages, shared_memory",
      Status: "news",
    });
    expect(rowWith("Content", "← messages: read m-1")).toMatchObject({
      Agent: "bob",
      Event: "read",
      Id: "m-1",
    });
  });

  it("marks a subagent's send", () => {
    renderView([
      { ...swarmSent("s", 1, { id: "m-1", sender: "alice" }), nested: true },
    ]);
    expect(rowWith("Id", "m-1").Agent).toBe("alice (subagent)");
  });

  it("sorts by a column", () => {
    renderView();
    fireEvent.click(within(grid()).getByText("Agent"));
    expect(rows().map((row) => row.Agent)).toEqual([
      "alice",
      "alice",
      "alice",
      "alice",
      "bob",
      "bob",
      "bob",
      "bob",
    ]);
  });

  it("shows the deliveries that woke a wait", () => {
    renderView([
      {
        ...swarmWaited("w", 1, "bob", 0.5, "news"),
        data: { version: 1, woken_by: [3, "x", 5] },
      },
    ]);
    fireEvent.click(within(grid()).getAllByRole("row")[1] ?? grid());
    expect(selected().textContent).toContain("woken by #3, #5");
  });

  it("finds text beyond a row's preview and selects the match", async () => {
    renderView([
      ...swarmCommunication(),
      swarmSent("s", 9, {
        id: "m-9",
        sender: "bob",
        content: `${"x".repeat(400)} needle`,
      }),
    ]);
    fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });
    fireEvent.change(await screen.findByPlaceholderText("Find"), {
      target: { value: "NEEDLE" },
    });
    expect(screen.getByTestId("find-band-match-count").textContent).toBe(
      "1 of 1"
    );
    expect(rows()).toHaveLength(9);
    expect(within(selected()).getByText(/needle$/)).toBeDefined();
  });

  it("finds a row by its time as shown", async () => {
    renderView();
    fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });
    fireEvent.change(await screen.findByPlaceholderText("Find"), {
      target: { value: fmtClock("2026-11-09T17:00:05.000Z") },
    });
    expect(
      within(selected()).getByRole("article").getAttribute("aria-label")
    ).toBe("Refused message from alice");
  });

  it("filters by a column", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Filter channel" }));
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Filter value" }),
      { target: { value: "shared_memory" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // alice's write, bob's read of it, and both waits on it.
    expect(rows().map((row) => row.Event)).toEqual([
      "waited",
      "sent",
      "waited",
      "read",
    ]);
  });

  it.each([
    // Only bob's reply answers a message.
    ["replyTo", "is not blank", ["m-3"]],
    // The two waits, the two reads and the refused send have no delivery.
    ["delivered", "is blank", ["", "m-1", "m-2", "", "w-1"]],
    // Only sends have a record kind.
    ["kind", "is blank", ["", "m-1", "", "w-1"]],
  ])("filters %s for %s values", async (column, operator, ids) => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: `Filter ${column}` }));
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Filter operator" }),
      { target: { value: operator } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(rows().map((row) => row.Id)).toEqual(ids);
  });

  it("shows log text in cells as untrusted text", () => {
    const hidden = "\u202E";
    renderView([
      swarmSent(
        "s",
        1,
        { id: "m-1", sender: `eve${hidden}lin`, recipients: ["bob"] },
        `chat${hidden}ten`
      ),
    ]);
    expect(rowWith("Id", "m-1")).toMatchObject({
      Agent: untrustedText(`eve${hidden}lin`),
      Channel: untrustedText(`chat${hidden}ten`),
    });
  });

  it("shows a malformed send from a log file as a plain sent row", () => {
    const raw = [{}, { record: null }, true, { record: false }].map(
      (send, index) => ({
        event: "communication",
        uuid: `bad-${index}`,
        timestamp: "2026-11-09T17:00:00Z",
        working_start: 0,
        kind: "sent",
        source: "inspect_swarm",
        agent: "alice",
        channel: "messages",
        send,
      })
    );
    renderView(normalizeEvents(raw));
    expect(rows().map((row) => row.Content)).toEqual(
      Array.from({ length: 4 }, () => "→ messages: sent")
    );
  });
});
