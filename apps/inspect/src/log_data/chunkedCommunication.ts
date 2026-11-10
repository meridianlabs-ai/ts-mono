/**
 * The Communication tab's events for a chunked sample read in windows. The
 * tab joins records within a swarm run, which takes the swarm_start events
 * and the span_begin of each acting member span as well as the communication
 * events themselves (`communicationEntries`). Those are read through the
 * chunk stats' type counts, so chunks holding none are never fetched, and
 * only the attachments the read events reference are resolved.
 */
import { skipToken } from "@tanstack/react-query";

import { normalizeEvent } from "@tsmono/inspect-common/normalize";
import type { Event } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import {
  FilteredCursor,
  type ChunkedSample,
  type OrdinalEvent,
} from "./chunked";
import { withAttachmentsResolved } from "./chunkedAttachments";
import { kSampleGcTimeMs } from "./sampleQuery";

/** Whether the sample has communication events, from its chunk stats alone. */
export const chunkedHasCommunication = (chunked: ChunkedSample): boolean =>
  chunked.stats.some((chunk) => (chunk.type_counts["communication"] ?? 0) > 0);

/**
 * The sample's communication events, its swarm_start events and the
 * span_begin of every member span a communication event names, in log order.
 */
export const readChunkedCommunicationEvents = async (
  chunked: ChunkedSample
): Promise<Event[]> => {
  const cursor = new FilteredCursor(
    chunked.events,
    chunked.stats,
    0,
    (type) => type === "communication" || type === "swarm"
  );
  const read: OrdinalEvent[] = [];
  for (let next = await cursor.next(); next; next = await cursor.next()) {
    const { ev } = next;
    if (
      ev.event === "communication" ||
      (ev.event === "swarm" && ev.kind === "swarm_start")
    ) {
      read.push(next);
    }
  }

  // Swarm members run in agent spans, which the skeleton always lists.
  const memberSpans = new Set(
    read.flatMap(({ ev }) =>
      ev.event === "communication" && ev.agent_span_id ? [ev.agent_span_id] : []
    )
  );
  const begins = chunked.skeleton.spans.flatMap((span) =>
    memberSpans.has(span.id) ? [span.begin] : []
  );
  const spanBegins = await Promise.all(
    begins.map(async (ordinal) => {
      const [ev] = await chunked.events.getRange(ordinal, ordinal + 1);
      return ev?.event === "span_begin" ? [{ ordinal, ev }] : [];
    })
  );

  const events = [...read, ...spanBegins.flat()]
    .sort((a, b) => a.ordinal - b.ordinal)
    .flatMap(({ ev }) => normalizeEvent(ev) ?? []);
  return withAttachmentsResolved(events, chunked, "communication events");
};

/**
 * The Communication tab's events for a windowed chunked sample, read when the
 * tab first mounts and cached with the sample.
 */
export const useChunkedCommunicationEvents = (
  handle: SampleHandle | undefined,
  chunked: ChunkedSample
): AsyncData<Event[]> =>
  useAsyncDataFromQuery({
    queryKey: [
      "log_data",
      "chunked-communication",
      handle?.logFile ?? null,
      handle?.id ?? null,
      handle?.epoch ?? null,
    ],
    queryFn: handle ? () => readChunkedCommunicationEvents(chunked) : skipToken,
    gcTime: kSampleGcTimeMs,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    structuralSharing: false,
  });
