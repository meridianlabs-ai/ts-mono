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

/** Null selects every agent or channel. */
export interface CommunicationFilter {
  agent: string | null;
  channel: string | null;
}

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
  // its run, the span that holds the acting member's span.
  const parents = new Map<string, string | null | undefined>();
  for (const event of events) {
    if (event.event === "span_begin") parents.set(event.id, event.parent_id);
  }
  const recordKey = (event: CommunicationEvent, id: string) => {
    const member = event.agent_span_id;
    const run = member ? (parents.get(member) ?? "") : "";
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

/** The agents a row involves: the one that acted and whom it reached. */
export const entryAgents = (entry: CommunicationEntry): string[] => {
  const { event } = entry;
  if (entry.type === "send") {
    return [
      event.agent,
      ...entry.send.record.recipients,
      ...entry.deliveries.flatMap((d) => d.delivery?.recipients ?? []),
    ];
  }
  return [event.agent, ...(event.delivery?.recipients ?? [])];
};

/** The channels a row went through; a wait's are the ones it waited on. */
export const entryChannels = (entry: CommunicationEntry): string[] => {
  const { event } = entry;
  if (event.channel !== null && event.channel !== undefined) {
    return [event.channel];
  }
  return event.wait?.channels ?? [];
};

export const filterEntries = (
  entries: CommunicationEntry[],
  filter: CommunicationFilter
): CommunicationEntry[] =>
  entries.filter(
    (entry) =>
      (filter.agent === null || entryAgents(entry).includes(filter.agent)) &&
      (filter.channel === null || entryChannels(entry).includes(filter.channel))
  );

/** Every agent and channel the rows name, sorted, for the filter menus. */
export const filterOptions = (
  entries: CommunicationEntry[]
): { agents: string[]; channels: string[] } => ({
  agents: sortedUnique(entries.flatMap(entryAgents)),
  channels: sortedUnique(entries.flatMap(entryChannels)),
});

const sortedUnique = (values: string[]): string[] =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));
