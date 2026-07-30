import { useMemo, useRef, useState } from "react";

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
 * is open — folding and chunked hydration are activation-latched on it,
 * so neither is ever paid at sample open) and `running` (live samples
 * surface "waiting", not "loading", before their first poll lands).
 */
export const useSampleMessages = (
  logDir: string,
  handle: SampleHandle | undefined,
  sampleData: EvalSampleData,
  active: boolean,
  running: boolean
): SampleMessages => {
  // Activation latch, per sample: the first Messages-tab open turns the
  // fold pipelines on for the sample's lifetime. Ungated they run at
  // sample open (whole-conversation fold, per-poll streaming refolds)
  // while another tab is shown; re-gating on `active` alone would drop
  // the fold cache and the hydrated chunked feed on every tab switch.
  const sampleKey = handle
    ? `${handle.logFile}|${handle.id}|${handle.epoch}`
    : null;
  const [activatedKey, setActivatedKey] = useState<string | null>(null);
  if (active && sampleKey !== null && activatedKey !== sampleKey) {
    setActivatedKey(sampleKey);
  }
  const activated =
    active || (sampleKey !== null && activatedKey === sampleKey);

  const isChunked = sampleData.chunked !== undefined;
  const chunkedMessages = useChunkedMessages(
    logDir,
    isChunked && activated ? handle : undefined,
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
  // Deliberately parallel to the source's own lazy fold, not duplication:
  // the resident path can never read through the async interface (the
  // atomic swap above), and the source's paged reads have no resident-path
  // caller — two consumers sharing one fold, buildMessageRows.
  const residentRows = useMemo(
    () =>
      activated && residentMessages
        ? buildMessageRows(residentMessages, kDefaultMessageRowOptions)
        : undefined,
    [activated, residentMessages]
  );
  // `activated` gates the query input too, or deferring the resident fold
  // would just move the sample-open fold into react-query
  const sourceRows = useMessageRows(
    logDir,
    handle,
    activated && residentRows === undefined ? source : undefined
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
    if (!activated || settledRows !== undefined || runningEvents.length === 0) {
      messagesRef.current = null;
      return undefined;
    }
    return buildMessageRows(
      messagesFromEvents(runningEvents, messagesRef),
      kDefaultMessageRowOptions
    );
    /* eslint-enable react-hooks/refs */
  }, [activated, settledRows, runningEvents]);

  const loading =
    // a created source whose rows haven't landed (and no streaming rows
    // covering the gap)
    (activated &&
      source !== undefined &&
      settledRows === undefined &&
      streamingRows === undefined) ||
    // chunked hydration in flight
    (isChunked && activated && chunkedMessages.loading) ||
    // monolith member fetch/parse (`running` keeps the streaming path's
    // pre-first-poll state on its "waiting" affordance instead)
    (sampleData.status === "loading" && !running);

  return {
    rows: settledRows ?? streamingRows ?? kNoRows,
    loading,
    source,
  };
};
