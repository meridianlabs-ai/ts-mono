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
import { normalizeEvent } from "@tsmono/inspect-common/normalize";

import {
  resolveAttachments,
  resolveEventAttachments,
} from "../utils/attachments";

import {
  SequenceReader,
  type ChunkedEvent,
  type ChunkedSample,
} from "./chunked";
import { log } from "./chunked/log";

/**
 * Substitute every attachment ref in `items` from the sample's attachments
 * sequence (fetches dedup through the shared chunk-byte store). `label`
 * names the batch in the read log; `resolve` decides which strings are refs
 * (`resolveEventAttachments` for events).
 */
export const withAttachmentsResolved = async <T>(
  items: T[],
  chunked: ChunkedSample,
  label: string,
  resolve: typeof resolveAttachments = resolveAttachments
): Promise<T[]> => {
  const refs = new Set<number>();
  // Resolving against no attachments reports every ref `resolve` would
  // substitute, so only those are fetched.
  for (const item of items) {
    resolve(item, {}, (id) => {
      // strict: refs substitute by the literal suffix, so non-canonical
      // forms ("1e2", "0x10", "-2") would fetch under a different key than
      // they substitute by (and -2 would index from the sequence end) —
      // treat them as unresolvable instead
      if (/^\d+$/.test(id)) {
        refs.add(Number(id));
      }
    });
  }
  if (refs.size === 0) {
    return items;
  }
  log.info(
    `resolve ${refs.size} attachment ref${refs.size === 1 ? "" : "s"} for ${label}`
  );
  const attachments: Record<string, string> = {};
  await Promise.all(
    [...refs].map(async (index) => {
      const [content] = await chunked.attachments.getRange(index, index + 1);
      if (content !== undefined) {
        attachments[String(index)] = content;
      }
    })
  );
  return items.map((item) => resolve(item, attachments));
};

/**
 * The sample's events reader with boundary normalization (#555) applied and
 * attachment refs resolved per chunk. Chunk-level caching means each chunk
 * normalizes and resolves once.
 *
 * Per-entry (not normalizeEvents): SequenceReader's index math derives from
 * fixed chunk starts, so the transform must be count-preserving — a dropped
 * entry would silently shift every later ordinal. Un-event-shaped entries
 * (impossible from our own chunker) pass through unchanged rather than
 * being dropped.
 */
export const resolvedEventsReader = (
  chunked: ChunkedSample
): SequenceReader<ChunkedEvent> =>
  chunked.events.withTransform((items, start) =>
    withAttachmentsResolved(
      items.map((item) => normalizeEvent(item) ?? item),
      chunked,
      `events chunk ${start}`,
      resolveEventAttachments
    )
  );
