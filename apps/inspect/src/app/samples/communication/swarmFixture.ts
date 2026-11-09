import { testCommunicationEvent } from "@tsmono/inspect-common/testing";
import type {
  CommunicationEvent,
  CommunicationRecord,
  CommunicationRejection,
} from "@tsmono/inspect-common/types";

// Events shaped like those inspect_swarm wrote for a two-member swarm with
// the messages and shared_memory channels (fixed uuids and times).

const at = (second: number): string =>
  new Date(Date.UTC(2026, 10, 9, 17, 0, second)).toISOString();

const swarmEvent = (
  uuid: string,
  second: number,
  overrides: Partial<CommunicationEvent>
): CommunicationEvent =>
  testCommunicationEvent({
    uuid,
    timestamp: at(second),
    working_start: second,
    source: "inspect_swarm",
    agent_span_id: `span-${overrides.agent ?? "test-agent"}`,
    loop_span_id: `span-${overrides.agent ?? "test-agent"}`,
    data: { version: 1 },
    ...overrides,
  });

export const swarmSent = (
  uuid: string,
  second: number,
  record: Partial<CommunicationRecord> & { id: string; sender: string },
  channel = "messages",
  rejected?: CommunicationRejection
): CommunicationEvent =>
  swarmEvent(uuid, second, {
    kind: "sent",
    agent: record.sender,
    channel,
    record_ids: [record.id],
    send: {
      record: { kind: "message", to: [], recipients: [], ...record },
      rejected,
    },
  });

export const swarmDelivered = (
  uuid: string,
  second: number,
  agent: string,
  recordId: string,
  recipients: string[],
  seq: number,
  channel = "messages"
): CommunicationEvent =>
  swarmEvent(uuid, second, {
    kind: "delivered",
    agent,
    channel,
    record_ids: [recordId],
    delivery: { recipients, seq },
    data: { version: 1, notify: recipients, result: null },
  });

export const swarmRead = (
  uuid: string,
  second: number,
  agent: string,
  channel: string,
  recordIds: string[],
  data: CommunicationEvent["data"] = { listing: false }
): CommunicationEvent =>
  swarmEvent(uuid, second, {
    kind: "read",
    agent,
    channel,
    record_ids: recordIds,
    data: { version: 1, ...data },
  });

export const swarmWaited = (
  uuid: string,
  second: number,
  agent: string,
  duration: number,
  outcome: string
): CommunicationEvent =>
  swarmEvent(uuid, second, {
    kind: "waited",
    agent,
    channel: null,
    record_ids: [],
    wait: {
      id: `x-${uuid}`,
      channels: ["messages", "shared_memory"],
      outcome,
      duration,
    },
  });

export const kLongMessage = [
  "Hi bob, please check a.md.",
  "It has the plan.",
  ...Array.from({ length: 20 }, (_, i) => `step ${i}`),
].join("\n");

/** One swarm sample's communication, in the order the log holds it. */
export const swarmCommunication = (): CommunicationEvent[] => [
  swarmSent("e1", 1, {
    id: "m-1",
    sender: "alice",
    to: ["bob"],
    recipients: ["bob"],
    content: kLongMessage,
  }),
  swarmDelivered("e2", 1, "alice", "m-1", ["bob"], 1),
  swarmWaited("e3", 2, "bob", 0.5, "news"),
  swarmSent(
    "e4",
    3,
    {
      id: "w-1",
      kind: "create",
      sender: "alice",
      content: "the plan",
    },
    "shared_memory"
  ),
  swarmDelivered("e5", 3, "alice", "w-1", [], 2, "shared_memory"),
  swarmRead("e6", 4, "bob", "messages", ["m-1"]),
  swarmSent(
    "e7",
    5,
    {
      id: "m-2",
      sender: "alice",
      to: ["all"],
      recipients: ["bob"],
      content: "status: plan written",
    },
    "messages",
    { control: "rate", reason: "rate limit: retry in 3600 s" }
  ),
  swarmSent("e8", 6, {
    id: "m-3",
    sender: "bob",
    to: ["alice"],
    recipients: ["alice"],
    content: "Got it, reading now.",
    reply_to: "m-1",
  }),
  swarmDelivered("e9", 6, "bob", "m-3", ["alice"], 3),
  swarmWaited("e10", 7, "alice", 1.25, "news"),
  swarmRead("e11", 8, "bob", "shared_memory", ["w-1"], {
    listing: false,
    files: [
      { file: "f-1", version: 1, record: "w-1", lines: null, deleted: false },
    ],
  }),
];
