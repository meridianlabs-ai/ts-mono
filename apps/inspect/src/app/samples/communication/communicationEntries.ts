import type {
  CommunicationEvent,
  CommunicationSend,
  Event,
} from "@tsmono/inspect-common/types";

/**
 * A send with the deliveries that joined it by record id, and the send it
 * replies to when that is in the sample.
 */
export interface SendEntry {
  type: "send";
  key: string;
  event: CommunicationEvent;
  send: CommunicationSend;
  deliveries: CommunicationEvent[];
  replyTo?: SendEntry;
}

/**
 * One row of the Communication tab: a send, or any other communication event
 * on a line of its own (a read, a wait, or a delivery whose send is not in
 * the sample).
 */
export type CommunicationEntry =
  SendEntry | { type: "line"; key: string; event: CommunicationEvent };

export const isCommunicationEvent = (
  event: Event
): event is CommunicationEvent => event.event === "communication";

export const hasCommunicationEvents = (events: readonly Event[]): boolean =>
  events.some(isCommunicationEvent);

/** The sample's communication events as rows, in time order. */
export const communicationEntries = (
  events: readonly Event[]
): CommunicationEntry[] => {
  const ordered = events
    .filter(isCommunicationEvent)
    .map((event, index) => ({
      event,
      index,
      time: Date.parse(event.timestamp),
    }))
    // Stable, so events with the same (or an unparsable) time keep log order.
    .sort((a, b) => a.time - b.time || 0);

  const keyOf = (event: CommunicationEvent, index: number) =>
    event.uuid ?? `communication-${index}`;
  // Record ids are unique only within one swarm run: every run, including
  // one nested in a member, restarts them. So a record is looked up within
  // its run. A run's member spans open in the span the swarm ran in, after
  // the swarm_start it writes there; one agent can run several swarms in its
  // own span, so the run is that span and how many swarm_starts it had when
  // the acting member's span opened.
  const starts = new Map<string, number>();
  const runs = new Map<string, string>();
  for (const event of events) {
    if (event.event === "swarm" && event.kind === "swarm_start") {
      const span = event.span_id ?? "";
      starts.set(span, (starts.get(span) ?? 0) + 1);
    } else if (event.event === "span_begin") {
      const parent = event.parent_id ?? "";
      runs.set(event.id, `${parent}#${starts.get(parent) ?? 0}`);
    }
  }
  const recordKey = (event: CommunicationEvent, id: string) => {
    const member = event.agent_span_id;
    const run = member ? (runs.get(member) ?? "") : "";
    return `${run}\u0000${id}`;
  };

  // Sends first, so a delivery joins its send whatever their order.
  const sends = new Map<CommunicationEvent, SendEntry>();
  const sendsByRecord = new Map<string, SendEntry>();
  for (const { event, index } of ordered) {
    if (event.kind !== "sent" || !event.send) continue;
    const entry: SendEntry = {
      type: "send",
      key: keyOf(event, index),
      event,
      send: event.send,
      deliveries: [],
    };
    sends.set(event, entry);
    for (const id of event.record_ids) {
      const key = recordKey(event, id);
      if (!sendsByRecord.has(key)) sendsByRecord.set(key, entry);
    }
  }
  for (const entry of sends.values()) {
    const replyTo = entry.send.record.reply_to;
    if (replyTo)
      entry.replyTo = sendsByRecord.get(recordKey(entry.event, replyTo));
  }

  const entries: CommunicationEntry[] = [];
  for (const { event, index } of ordered) {
    const send = sends.get(event);
    if (send) {
      entries.push(send);
      continue;
    }
    const joined =
      event.kind === "delivered"
        ? event.record_ids
            .map((id) => sendsByRecord.get(recordKey(event, id)))
            .find((entry) => entry !== undefined)
        : undefined;
    if (joined) {
      joined.deliveries.push(event);
    } else {
      entries.push({ type: "line", key: keyOf(event, index), event });
    }
  }
  return entries;
};

/** The channels a row went through; a wait's are the ones it waited on. */
export const entryChannels = (entry: CommunicationEntry): string[] => {
  const { event } = entry;
  if (event.channel !== null && event.channel !== undefined) {
    return [event.channel];
  }
  return event.wait?.channels ?? [];
};

/** A row's deliveries: a send's joined ones, or a delivery row itself. */
export const entryDeliveries = (
  entry: CommunicationEntry
): CommunicationEvent[] => {
  if (entry.type === "send") return entry.deliveries;
  return entry.event.kind === "delivered" ? [entry.event] : [];
};

/**
 * The members a delivery was news to when it was committed (inspect_swarm's
 * `notify`): a message's recipients, or for a shared-memory write the
 * members that had not seen the written files' current versions.
 */
export const deliveryNotify = (delivery: CommunicationEvent): string[] => {
  const notify = delivery.data["notify"];
  return Array.isArray(notify)
    ? notify.filter((name): name is string => typeof name === "string")
    : [];
};

/** The delivery numbers that ended a wait (inspect_swarm's `woken_by`). */
export const waitWokenBy = (wait: CommunicationEvent): number[] => {
  const wokenBy = wait.data["woken_by"];
  return Array.isArray(wokenBy)
    ? wokenBy.filter((seq): seq is number => typeof seq === "number")
    : [];
};
