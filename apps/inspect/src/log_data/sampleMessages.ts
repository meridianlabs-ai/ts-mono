import { useMemo, useRef } from "react";

import {
  buildMessageRows,
  type MessageRow,
} from "@tsmono/inspect-components/chat";

import { SampleHandle } from "../app/types";

import { useChunkedMessages } from "./chunkedMessages";
import {
  inMemoryMessageRows,
  kDefaultMessageRowOptions,
  type SampleMessagesData,
} from "./messageRows";
import { useMessageRows } from "./messageRowsQuery";
import {
  messagesFromEvents,
  type MessagesFromEventsState,
} from "./messagesFromEvents";
import { type EvalSampleData } from "./sampleData";

const kNoRows: MessageRow[] = [];

export interface SampleMessages {
  /** The rows the Messages tab renders. */
  rows: MessageRow[];
  /** Data that will produce messages is still in flight (monolith sample
   *  fetch, chunked hydration, rows materialization) — render a loading
   *  affordance, never "No messages". */
  loading: boolean;
  /** The settled conversation's source — `exportText` backs copy/download.
   *  Undefined while loading and on the streaming path. */
  source: SampleMessagesData | undefined;
}

/**
 * The Messages tab's one entry point: which feed serves the conversation —
 * completed monolith messages, a hydrated chunked sample, or the live
 * event stream — is selected here, behind the SampleMessagesData seam.
 * The view consumes rows and reports two gates it owns: `active` (the tab
 * is open — full hydration of a chunked monster is never paid at sample
 * open) and `running` (live samples surface "waiting", not "loading",
 * before their first poll lands).
 */
export const useSampleMessages = (
  logDir: string,
  handle: SampleHandle | undefined,
  sampleData: EvalSampleData,
  active: boolean,
  running: boolean
): SampleMessages => {
  const isChunked = sampleData.chunked !== undefined;
  const chunkedMessages = useChunkedMessages(
    logDir,
    isChunked && active ? handle : undefined,
    sampleData.chunked
  );

  const residentMessages = isChunked
    ? chunkedMessages.data
    : sampleData.sample?.messages;
  const source = useMemo(
    () =>
      residentMessages ? inMemoryMessageRows(residentMessages) : undefined,
    [residentMessages]
  );
  // Resident feeds fold here, synchronously, instead of through the rows
  // query: the settled sample and the cleared streaming feed arrive on the
  // same render (see settledSampleData), so rows must swap atomically — an
  // async hop would unmount the list mid-handoff, losing its live-finish
  // scroll behavior. The query serves only sources that actually need an
  // async read (none in this stage; the windowed chunked source will).
  const residentRows = useMemo(
    () =>
      residentMessages
        ? buildMessageRows(residentMessages, kDefaultMessageRowOptions)
        : undefined,
    [residentMessages]
  );
  const sourceRows = useMessageRows(
    logDir,
    handle,
    residentRows === undefined ? source : undefined
  );
  const settledRows = sourceRows ?? residentRows;

  // Streaming path: rows derived from the event stream each poll. The
  // polling pipeline only ever appends to the running events array (or
  // replaces a tail event during streaming updates), so the cached state
  // makes a pure-extension call process only the new tail; diverging
  // events trigger a rebuild. Streaming rows stay up until the source's
  // rows land — a live sample's finish must swap feeds without a frame of
  // empty list (that would unmount the view and lose its scroll handoff).
  const messagesRef = useRef<MessagesFromEventsState | null>(null);
  const runningEvents = sampleData.running;
  const streamingRows = useMemo(() => {
    /* eslint-disable react-hooks/refs */
    if (settledRows !== undefined || runningEvents.length === 0) {
      messagesRef.current = null;
      return undefined;
    }
    return buildMessageRows(
      messagesFromEvents(runningEvents, messagesRef),
      kDefaultMessageRowOptions
    );
    /* eslint-enable react-hooks/refs */
  }, [settledRows, runningEvents]);

  const loading =
    // a created source whose rows haven't landed (and no streaming rows
    // covering the gap)
    (source !== undefined &&
      settledRows === undefined &&
      streamingRows === undefined) ||
    // chunked hydration in flight
    (isChunked && active && chunkedMessages.loading) ||
    // monolith member fetch/parse (`running` keeps the streaming path's
    // pre-first-poll state on its "waiting" affordance instead)
    (sampleData.status === "loading" && !running);

  return {
    rows: settledRows ?? streamingRows ?? kNoRows,
    loading,
    source,
  };
};
