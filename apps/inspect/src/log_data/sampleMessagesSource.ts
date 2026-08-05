/**
 * Feed selection for a settled sample's conversation: which
 * SampleMessagesData backs reads and exports. Chunked samples get the
 * windowed source over their conversation seam, memoized per
 * ChunkedSample so the Messages tab and exports share one row index (and
 * the chunk caches beneath it); monolith samples read their inline
 * message array.
 */
import { type ChunkedSample } from "./chunked";
import { chunkedConversation } from "./conversation";
import { inMemoryMessageRows, type SampleMessagesData } from "./messageRows";
import { windowedMessageRows } from "./messageRowsWindowed";
import { type EvalSampleData } from "./sampleData";

const chunkedSources = new WeakMap<ChunkedSample, SampleMessagesData>();

export const chunkedMessageRows = (
  chunked: ChunkedSample
): SampleMessagesData => {
  let source = chunkedSources.get(chunked);
  if (!source) {
    source = windowedMessageRows(chunkedConversation(chunked));
    chunkedSources.set(chunked, source);
  }
  return source;
};

/**
 * The source for a settled sample — undefined when there is nothing
 * settled to read (live streaming samples, a sample still loading).
 */
export const sampleMessagesSource = (
  sampleData: EvalSampleData
): SampleMessagesData | undefined => {
  if (sampleData.chunked) {
    return chunkedMessageRows(sampleData.chunked);
  }
  const messages = sampleData.sample?.messages;
  return messages ? inMemoryMessageRows(messages) : undefined;
};
