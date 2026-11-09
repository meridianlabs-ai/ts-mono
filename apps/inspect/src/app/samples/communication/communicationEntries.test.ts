import { describe, expect, it } from "vitest";

import { testInfoEvent } from "@tsmono/inspect-common/testing";

import {
  communicationEntries,
  filterEntries,
  filterOptions,
  hasCommunicationEvents,
  type CommunicationEntry,
} from "./communicationEntries";
import {
  swarmCommunication,
  swarmDelivered,
  swarmRead,
  swarmSent,
} from "./swarmFixture";

const keys = (entries: CommunicationEntry[]) => entries.map((e) => e.key);

describe("hasCommunicationEvents", () => {
  it("is true only when a communication event is present", () => {
    expect(hasCommunicationEvents([testInfoEvent()])).toBe(false);
    expect(
      hasCommunicationEvents([testInfoEvent(), ...swarmCommunication()])
    ).toBe(true);
  });
});

describe("communicationEntries", () => {
  it("joins each delivery to its send by record id", () => {
    const entries = communicationEntries(swarmCommunication());
    // Deliveries e2, e5 and e9 are folded into their sends.
    expect(keys(entries)).toEqual([
      "e1",
      "e3",
      "e4",
      "e6",
      "e7",
      "e8",
      "e10",
      "e11",
    ]);
    const send = (key: string) => {
      const entry = entries.find((e) => e.key === key);
      return entry?.type === "send" ? entry : undefined;
    };
    expect(send("e1")?.deliveries.map((d) => d.uuid)).toEqual(["e2"]);
    expect(send("e8")?.deliveries.map((d) => d.uuid)).toEqual(["e9"]);
    // A refused send has no delivery.
    expect(send("e7")?.deliveries).toEqual([]);
  });

  it("joins a delivery logged before its send", () => {
    const entries = communicationEntries([
      swarmDelivered("d", 1, "alice", "m-1", ["bob"], 1),
      swarmSent("s", 1, { id: "m-1", sender: "alice", recipients: ["bob"] }),
    ]);
    expect(keys(entries)).toEqual(["s"]);
  });

  it("keeps a delivery whose send is not in the sample on its own row", () => {
    const entries = communicationEntries([
      swarmDelivered("d", 1, "alice", "m-9", ["bob"], 4),
    ]);
    expect(entries).toEqual([
      expect.objectContaining({ type: "line", key: "d" }),
    ]);
  });

  it("orders rows by time, keeping log order for equal times", () => {
    const entries = communicationEntries([
      swarmRead("late", 9, "bob", "messages", []),
      swarmRead("first", 1, "bob", "messages", []),
      swarmRead("second", 1, "alice", "messages", []),
    ]);
    expect(keys(entries)).toEqual(["first", "second", "late"]);
  });
});

describe("filterEntries", () => {
  const entries = communicationEntries(swarmCommunication());

  it("by agent keeps what the agent did and what reached it", () => {
    const shown = filterEntries(entries, { agent: "bob", channel: null });
    // alice's message to bob and refused broadcast, and bob's own wait,
    // reads and reply; not alice's write to shared memory or her wait.
    expect(keys(shown)).toEqual(["e1", "e3", "e6", "e7", "e8", "e11"]);
  });

  it("by channel keeps its sends and reads, and waits on it", () => {
    const shown = filterEntries(entries, {
      agent: null,
      channel: "shared_memory",
    });
    expect(keys(shown)).toEqual(["e3", "e4", "e10", "e11"]);
  });

  it("by agent and channel keeps rows that match both", () => {
    const shown = filterEntries(entries, {
      agent: "alice",
      channel: "shared_memory",
    });
    expect(keys(shown)).toEqual(["e4", "e10"]);
  });

  it("offers every agent and channel the rows name", () => {
    expect(filterOptions(entries)).toEqual({
      agents: ["alice", "bob"],
      channels: ["messages", "shared_memory"],
    });
  });
});
