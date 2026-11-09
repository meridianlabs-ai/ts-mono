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
  inSwarmRun,
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

describe.each([
  ["each in its own span", "run-1", "run-2"],
  // An agent can run one swarm after another in its own span.
  ["one after the other in one span", "wrapper", "wrapper"],
])(
  "communicationEntries with two swarm runs %s",
  (_, firstSpan, secondSpan) => {
    // Each run restarts its record ids, so both have an m-1 and a w-1.
    const secondRun = [
      swarmSent("r2-e1", 20, {
        id: "m-1",
        sender: "carol",
        to: ["dave"],
        recipients: ["dave"],
        content: "hi dave",
      }),
      swarmDelivered("r2-e2", 20, "carol", "m-1", ["dave"], 1),
      swarmSent("r2-e3", 21, {
        id: "m-2",
        sender: "dave",
        to: ["carol"],
        recipients: ["carol"],
        content: "hi carol",
        reply_to: "m-1",
      }),
      swarmDelivered("r2-e4", 21, "dave", "m-2", ["carol"], 2),
      swarmSent(
        "r2-e5",
        22,
        { id: "w-1", kind: "create", sender: "carol", content: "notes" },
        "shared_memory"
      ),
      swarmDelivered("r2-e6", 22, "carol", "w-1", [], 3, "shared_memory"),
    ];
    const entries = communicationEntries([
      ...inSwarmRun(firstSpan, swarmCommunication()),
      ...inSwarmRun(secondSpan, secondRun),
    ]);
    const send = (key: string) => {
      const entry = entries.find((e) => e.key === key);
      return entry?.type === "send" ? entry : undefined;
    };

    it("joins each delivery to the send of its own run", () => {
      expect(send("e1")?.deliveries.map((d) => d.uuid)).toEqual(["e2"]);
      expect(send("r2-e1")?.deliveries.map((d) => d.uuid)).toEqual(["r2-e2"]);
      expect(send("e4")?.deliveries.map((d) => d.uuid)).toEqual(["e5"]);
      expect(send("r2-e5")?.deliveries.map((d) => d.uuid)).toEqual(["r2-e6"]);
    });

    it("resolves a reply within its own run", () => {
      expect(send("e8")?.replyTo?.key).toBe("e1");
      expect(send("r2-e3")?.replyTo?.key).toBe("r2-e1");
    });

    it("filters an agent to its own run's records", () => {
      const shown = filterEntries(entries, { agent: "dave", channel: null });
      expect(keys(shown)).toEqual(["r2-e1", "r2-e3"]);
    });
  }
);

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
