import { asyncJsonParseBytes } from "../../utils/json-worker";
import { PendingSampleUrls, SampleData, SegmentRef } from "../api/types";
import { ApiError } from "../api/view-server/request";

import { openZipFileFromBuffer } from "./remoteZipFile";

// Cap segments per call so the poll loop can yield between chunks (via the
// polling helper's "immediate" setTimeout(0)) — without this, long-running
// evals with thousands of segments starve the renderer. 25 keeps each chunk
// under ~1s at typical segment sizes.
const SEGMENT_CAP_PER_CALL = 25;

export type GetPendingSampleDataUrls = (
  log_file: string,
  id: string | number,
  epoch: number,
  last_event?: number,
  last_attachment?: number,
  last_message_pool?: number,
  last_call_pool?: number,
  max_segments?: number
) => Promise<PendingSampleUrls>;

export interface DirectPendingResult {
  sampleData: SampleData;
  has_more: boolean;
  complete: boolean;
}

/**
 * Fetch one chunk of pending-sample data via presigned S3 URLs.
 * Returns `undefined` when this transport isn't supported (404, or any
 * segment lacks a presigned URL); all other failures throw.
 */
export const fetchPendingSampleDataDirect = async (
  getUrls: GetPendingSampleDataUrls,
  log_file: string,
  id: string | number,
  epoch: number,
  cursors: {
    last_event?: number;
    last_attachment?: number;
    last_message_pool?: number;
    last_call_pool?: number;
  }
): Promise<DirectPendingResult | undefined> => {
  let urls: PendingSampleUrls;
  try {
    urls = await getUrls(
      log_file,
      id,
      epoch,
      cursors.last_event,
      cursors.last_attachment,
      cursors.last_message_pool,
      cursors.last_call_pool,
      SEGMENT_CAP_PER_CALL
    );
  } catch (e) {
    // 404 = endpoint missing on this server; treat as "not supported".
    if (e instanceof ApiError && e.status === 404) {
      return undefined;
    }
    throw e;
  }

  if (urls.segments.length === 0) {
    return {
      sampleData: {
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      },
      has_more: urls.has_more === true,
      complete: urls.complete === true,
    };
  }

  const canDirect = urls.segments.every((s) => s.direct_url != null);
  if (!canDirect) {
    return undefined;
  }

  // Fetch concurrently but concatenate in segment order — downstream code
  // expects events/attachments in id order.
  const parts: SampleData[] = await Promise.all(
    urls.segments.map((seg: SegmentRef) => readSegment(seg))
  );
  const out: SampleData = {
    events: parts.flatMap((p) => p.events),
    attachments: parts.flatMap((p) => p.attachments),
    message_pool: parts.flatMap((p) => p.message_pool),
    call_pool: parts.flatMap((p) => p.call_pool),
  };
  return {
    sampleData: applyCursorFilter(out, cursors),
    has_more: urls.has_more === true,
    complete: urls.complete === true,
  };
};

const readSegment = async (seg: SegmentRef): Promise<SampleData> => {
  const url = seg.direct_url as string;
  // Whole-zip fetch: segments contain one member per (sample, epoch), so
  // the zip is ~the member plus trivial framing — ranging buys nothing.
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `Failed to fetch segment: ${resp.status} ${resp.statusText}`
    );
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const zip = await openZipFileFromBuffer(bytes);
  const memberBytes = await zip.readFile(seg.member_name);
  return (await asyncJsonParseBytes(memberBytes)) as SampleData;
};

// Over-inclusive segment filter -> per-item filter here. Mirrors
// SampleBufferFilestore.get_sample_data. `-1` acts as "no cursor".
const applyCursorFilter = (
  out: SampleData,
  cursors: {
    last_event?: number;
    last_attachment?: number;
    last_message_pool?: number;
    last_call_pool?: number;
  }
): SampleData => {
  const lastEvent = cursors.last_event ?? -1;
  const lastAttachment = cursors.last_attachment ?? -1;
  const lastMessagePool = cursors.last_message_pool ?? -1;
  const lastCallPool = cursors.last_call_pool ?? -1;
  out.events = out.events.filter((e) => e.id > lastEvent);
  out.attachments = out.attachments.filter((a) => a.id > lastAttachment);
  out.message_pool = out.message_pool.filter((m) => m.id > lastMessagePool);
  out.call_pool = out.call_pool.filter((c) => c.id > lastCallPool);
  return out;
};
