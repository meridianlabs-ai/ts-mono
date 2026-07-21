/**
 * The open path for a chunked sample: parse the shell + sidecars and build
 * per-sequence readers over one shared chunk-byte store. Everything here is
 * plain byte-range/entry reads — no server endpoint is ever required
 * (design/large-samples.md, core principle "sealed logs = range reads
 * only").
 */
import type { ChatMessage } from "@tsmono/inspect-common";

import {
  ChunkByteStore,
  SequenceReader,
  type EntryByteSource,
} from "./chunkStore";
import {
  chunkEntryName,
  metadataEntryName,
  shellEntryName,
  skeletonEntryName,
  statsEntryName,
} from "./format";
import { SkeletonIndex } from "./skeletonIndex";
import type {
  ChunkedEvent,
  ChunkedSampleShell,
  EventChunkStats,
  EventStats,
  SampleSkeleton,
} from "./types";

export interface ChunkedSample {
  shell: ChunkedSampleShell;
  skeleton: SampleSkeleton;
  skel: SkeletonIndex;
  stats: EventChunkStats[];
  events: SequenceReader<ChunkedEvent>;
  messages: SequenceReader<ChatMessage>;
  calls: SequenceReader<unknown>;
  attachments: SequenceReader<string>;
  /** Fetch `metadata.json` (undefined when the sample has no metadata). */
  readMetadata?: () => Promise<Record<string, unknown>>;
}

const decoder = new TextDecoder();

const readJson = async <T>(source: EntryByteSource, name: string): Promise<T> =>
  JSON.parse(decoder.decode(await source.readFile(name))) as T;

/**
 * Open a chunked sample. `entryNames` is the log's central-directory name
 * set (used only to detect the optional metadata entry); the three parsed
 * artifacts — shell, skeleton, stats — are fetched in parallel.
 */
export const openChunkedSample = async (
  source: EntryByteSource,
  entryNames: ReadonlySet<string>,
  id: string | number,
  epoch: number,
  byteBudget?: number
): Promise<ChunkedSample> => {
  const [shell, skeleton, stats] = await Promise.all([
    readJson<ChunkedSampleShell>(source, shellEntryName(id, epoch)),
    readJson<SampleSkeleton>(source, skeletonEntryName(id, epoch)),
    readJson<EventStats>(source, statsEntryName(id, epoch)),
  ]);

  const bytes = new ChunkByteStore(source, byteBudget);
  const reader = <T>(
    sequence: "messages" | "events" | "calls" | "attachments"
  ) =>
    new SequenceReader<T>(
      bytes,
      (start) => chunkEntryName(id, epoch, sequence, start),
      shell.sequences[sequence] ?? []
    );

  const metadataEntry = metadataEntryName(id, epoch);
  return {
    shell,
    skeleton,
    skel: new SkeletonIndex(skeleton),
    stats: stats.chunks,
    events: reader<ChunkedEvent>("events"),
    messages: reader<ChatMessage>("messages"),
    calls: reader<unknown>("calls"),
    attachments: reader<string>("attachments"),
    ...(entryNames.has(metadataEntry)
      ? {
          readMetadata: () =>
            readJson<Record<string, unknown>>(source, metadataEntry),
        }
      : {}),
  };
};
