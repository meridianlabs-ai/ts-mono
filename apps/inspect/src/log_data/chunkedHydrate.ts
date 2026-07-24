/**
 * Full hydration of a chunked sample into a resolved `EvalSample`
 * (design/large-samples.md, change log 2026-07-22, "Fidelity plan").
 *
 * A sample that carries producer-authored timelines (or branch/anchor
 * events) renders correctly only through the legacy transcript pipeline,
 * which needs the whole event stream in memory. For such samples — when
 * they are small enough — we download every sequence and reassemble the
 * monolith `EvalSample` shape, then run it through the same
 * `resolveSample` the monolith path uses (pool-ref expansion + attachment
 * resolution). The result is indistinguishable from a monolith read, so
 * every legacy surface (transcript, timelines, forks, messages, JSON tab)
 * works unchanged.
 */
import { EvalSample } from "@tsmono/inspect-common/types";

import type { LogZipAccess } from "../client/remote/remoteLogFile";

import { samplePrefix, type ChunkedSample } from "./chunked";
import { resolveSample } from "./sampleFetch";

/**
 * Full-download size gate for timeline'd chunked samples
 * (`TIMELINE_HYDRATION_BYTES` in the spec's named-constants table).
 */
export const TIMELINE_HYDRATION_BYTES = 50 * 1024 * 1024;

/** Sum of uncompressed entry sizes under `{prefix}/{sequence}/`. */
const sequenceBytes = (
  zip: LogZipAccess,
  id: string | number,
  epoch: number,
  sequence: "events" | "attachments"
): number => {
  const prefix = `${samplePrefix(id, epoch)}/${sequence}/`;
  let total = 0;
  for (const name of zip.entryNames) {
    if (name.startsWith(prefix)) {
      total += zip.uncompressedSize(name) ?? 0;
    }
  }
  return total;
};

/**
 * Whether the sample needs legacy-pipeline fidelity (producer timelines or
 * branch/anchor events) and is small enough to download whole. Both checks
 * are free: shell + stats are already parsed, sizes come from the central
 * directory.
 */
export const shouldFullyHydrate = (
  chunked: ChunkedSample,
  zip: LogZipAccess
): boolean => {
  const needsTimelines =
    (chunked.shell.timelines?.length ?? 0) > 0 ||
    chunked.stats.some(
      (chunk) =>
        (chunk.type_counts["branch"] ?? 0) > 0 ||
        (chunk.type_counts["anchor"] ?? 0) > 0
    );
  if (!needsTimelines) {
    return false;
  }
  const { id, epoch } = chunked.shell;
  const bytes =
    sequenceBytes(zip, id, epoch, "events") +
    sequenceBytes(zip, id, epoch, "attachments");
  return bytes <= TIMELINE_HYDRATION_BYTES;
};

/**
 * Download all four sequences and reassemble the monolith `EvalSample`
 * shape: the message sequence doubles as the `events_data` pool (indices
 * preserved by the converter), `message_refs` rebuild the final
 * conversation, and attachments become an index-keyed map. `resolveSample`
 * then expands pool refs and resolves `attachment://<index>` refs exactly
 * as it does for monolith samples.
 */
export const hydrateFullSample = async (
  chunked: ChunkedSample
): Promise<EvalSample> => {
  const [events, messages, calls, attachments, metadata] = await Promise.all([
    chunked.events.getRange(0, chunked.events.knownCount),
    chunked.messages.getRange(0, Number.MAX_SAFE_INTEGER),
    chunked.calls.getRange(0, Number.MAX_SAFE_INTEGER),
    chunked.attachments.getRange(0, Number.MAX_SAFE_INTEGER),
    chunked.readMetadata?.() ?? Promise.resolve({}),
  ]);
  // `sequences` is the pre-central-directory chunk layout — logs converted
  // before it was dropped still carry it; strip it so it never leaks into
  // the synthesized EvalSample
  const { message_refs, sequences: _sequences, ...shell } = chunked.shell;
  return resolveSample({
    ...shell,
    messages: message_refs.flatMap(([start, end]) =>
      messages.slice(start, end)
    ),
    events,
    events_data: { messages, calls },
    attachments: Object.fromEntries(
      attachments.map((content, index) => [String(index), content])
    ),
    metadata,
  });
};
