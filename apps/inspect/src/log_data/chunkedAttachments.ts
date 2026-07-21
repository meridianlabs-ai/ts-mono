/**
 * Attachment resolution for chunked samples: event chunks are materialized
 * with their `attachment://<index>` refs substituted before anything
 * downstream (decode walk, renderers) sees them — the UI never sees a ref
 * (design/large-samples.md, "Data-loading architecture"). Resolution is
 * per-chunk: refs are collected from the parsed chunk, the covering
 * attachment chunks fetched, and the existing `resolveAttachments`
 * substitution applied. ModelEvent `input_refs` message ranges are NOT
 * resolved here — they stay lazy (Confounder 1: the last event references
 * essentially the whole conversation).
 */
import { resolveAttachments } from "../utils/attachments";

import {
  SequenceReader,
  type ChunkedEvent,
  type ChunkedSample,
} from "./chunked";

const ATTACHMENT_PROTOCOL = "attachment://";
const CONTENT_PROTOCOL = "tc://";

const collectRefs = (value: unknown, into: Set<number>): void => {
  if (typeof value === "string") {
    const ref = value.startsWith(CONTENT_PROTOCOL)
      ? value.replace(CONTENT_PROTOCOL, ATTACHMENT_PROTOCOL)
      : value;
    if (ref.startsWith(ATTACHMENT_PROTOCOL)) {
      const index = Number(ref.slice(ATTACHMENT_PROTOCOL.length));
      if (Number.isInteger(index)) {
        into.add(index);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, into);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectRefs(item, into);
    }
  }
};

/**
 * The sample's events reader with attachment refs resolved per chunk.
 * Chunk-level caching means each chunk resolves once; attachment fetches
 * dedup through the shared chunk-byte store.
 */
export const resolvedEventsReader = (
  chunked: ChunkedSample
): SequenceReader<ChunkedEvent> =>
  chunked.events.withTransform(async (items) => {
    const refs = new Set<number>();
    collectRefs(items, refs);
    if (refs.size === 0) {
      return items;
    }
    const attachments: Record<string, string> = {};
    await Promise.all(
      [...refs].map(async (index) => {
        const [content] = await chunked.attachments.getRange(index, index + 1);
        if (content !== undefined) {
          attachments[String(index)] = content;
        }
      })
    );
    return items.map((ev) => resolveAttachments(ev, attachments));
  });
