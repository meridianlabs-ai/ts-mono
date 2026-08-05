import { useMemo, useRef, useState } from "react";

import {
  buildMessageRows,
  type MessageRow,
} from "@tsmono/inspect-components/chat";
import { loading as asyncLoading } from "@tsmono/util";

import { Events } from "../@types/extraInspect";
import { SampleHandle } from "../app/types";

import { kDefaultMessageRowOptions } from "./messageRows";
import {
  unpagedFeed,
  useMessageRows,
  type MessageRowsFeed,
} from "./messageRowsQuery";
import {
  messagesFromEvents,
  type MessagesFromEventsState,
} from "./messagesFromEvents";
import { type EvalSampleData } from "./sampleData";

const kNoRows: MessageRow[] = [];

/**
 * The streaming rows: derived from the event stream each poll while the
 * Messages tab is shown, and latched across the live-finish handoff — the
 * settled feed's read is asynchronous, so the last streaming rows stay up
 * until it settles (`relieved`). Without the bridge the finish would blank
 * the list for the read's pending frames, unmounting it and losing its
 * scroll handoff. The held rows never cross samples, and hiding the tab
 * drops the rows entirely: nothing mid-stream is worth keeping warm — the
 * fold reruns per poll by design — so a hidden tab shouldn't pay
 * O(conversation) per poll; returning rebuilds once from the events.
 */
const useStreamingRowsLatch = (
  active: boolean,
  relieved: boolean,
  runningEvents: Events,
  sampleKey: string | null
): MessageRow[] | undefined => {
  // Incremental messagesFromEvents state: the polling pipeline only ever
  // appends to the running events array (or replaces a tail event during
  // streaming updates), so a pure-extension call processes only the new
  // tail; diverging events trigger a rebuild.
  const messagesRef = useRef<MessagesFromEventsState | null>(null);
  const heldRef = useRef<{ key: string | null; rows: MessageRow[] } | null>(
    null
  );

  /* eslint-disable react-hooks/refs */
  const built = useMemo(() => {
    if (!active || relieved || runningEvents.length === 0) {
      messagesRef.current = null;
      return undefined;
    }
    return buildMessageRows(
      messagesFromEvents(runningEvents, messagesRef),
      kDefaultMessageRowOptions
    );
  }, [active, relieved, runningEvents]);

  if (relieved || heldRef.current?.key !== sampleKey) {
    heldRef.current = null;
  }
  if (built !== undefined) {
    heldRef.current = { key: sampleKey, rows: built };
    return built;
  }
  // The bridge: the stream ended (finish clears the events) but the settled
  // read hasn't landed — keep the last streaming rows up.
  return active && runningEvents.length === 0
    ? heldRef.current?.rows
    : undefined;
  /* eslint-enable react-hooks/refs */
};

/**
 * The Messages tab's one entry point: the settled conversation's rows read
 * through `useMessageRows` — a paged feed whose loaded prefix the list
 * extends by scrolling — with the live event stream serving rows until
 * a settled feed exists. The view consumes the result and reports two
 * gates it owns: `active` (the tab is open — the settled read and chunked
 * hydration are activation-latched on it, so neither is ever paid at
 * sample open) and `running` (live samples surface "waiting", not
 * "loading", before their first poll lands).
 *
 * `rows.data` is the rows to render (a settled prefix, streaming rows, or
 * an empty settled conversation); `rows.loading` means data that will
 * produce messages is still in flight (monolith fetch, chunked hydration,
 * first-page materialization); `rows.error` means the conversation failed
 * to materialize. On loading and error the view renders that affordance,
 * never "No messages". Streaming rows are never paged (`hasMore` false):
 * the event feed always renders whole.
 */
export const useSampleMessages = (
  handle: SampleHandle | undefined,
  sampleData: EvalSampleData,
  active: boolean,
  running: boolean
): MessageRowsFeed => {
  // Activation latch: the first Messages-tab open turns the settled read
  // and chunked hydration on while the user stays on the sample. Ungated
  // they run at sample open (whole-conversation fold, hydration) while
  // another tab is shown; re-gating on `active` alone would drop the rows
  // and the hydrated chunked feed on every tab switch. "Activated"
  // means since ARRIVING at this sample — the latch resets whenever the
  // sample changes (the hook mounts unkeyed in SampleDisplay, so state
  // survives navigation; without the reset, returning to the last-activated
  // sample would pay fold + hydration at open with the tab closed).
  const sampleKey = handle
    ? `${handle.logFile}|${handle.id}|${handle.epoch}`
    : null;
  const [latch, setLatch] = useState<{
    key: string | null;
    activated: boolean;
  }>({ key: null, activated: false });
  if (latch.key !== sampleKey) {
    setLatch({ key: sampleKey, activated: active });
  } else if (active && !latch.activated) {
    setLatch({ key: sampleKey, activated: true });
  }
  const activated = active || (latch.key === sampleKey && latch.activated);

  const settled = useMessageRows(handle, sampleData, activated);
  const streamingRows = useStreamingRowsLatch(
    active,
    settled?.rows.data !== undefined || settled?.rows.error !== undefined,
    sampleData.running,
    sampleKey
  );

  const status = sampleData.status;
  return useMemo(() => {
    if (settled?.rows.error !== undefined || settled?.rows.data !== undefined) {
      return settled;
    }
    if (streamingRows !== undefined) {
      return unpagedFeed({ data: streamingRows, loading: false });
    }
    // the settled read/hydration in flight, or the monolith member
    // fetch/parse (`running` keeps the streaming path's pre-first-poll
    // state on its "waiting" affordance instead)
    if (settled?.rows.loading || (status === "loading" && !running)) {
      return unpagedFeed(asyncLoading);
    }
    return unpagedFeed({ data: kNoRows, loading: false });
  }, [settled, streamingRows, status, running]);
};
