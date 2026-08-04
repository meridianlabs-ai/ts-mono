import { useMemo } from "react";

import { type EvalSampleData } from "./sampleData";
import { sampleMessagesSource } from "./sampleMessagesSource";

/**
 * Copy/Download > Messages: the settled conversation's text parts, produced
 * on demand through the same source the Messages tab reads (chunked samples
 * stream window by window off the shared chunk caches — export never
 * hydrates a conversation, and never requires the tab to have been opened).
 * Concatenating the parts yields the whole text; sinks pick their assembly
 * (join for the clipboard, a Blob for downloads so the browser owns the
 * buffers). Undefined when there is no settled conversation to export
 * (live streaming samples, a sample still loading).
 */
export const useMessagesExport = (
  sampleData: EvalSampleData
): (() => Promise<string[]>) | undefined =>
  useMemo(() => {
    const source = sampleMessagesSource(sampleData);
    if (!source) {
      return undefined;
    }
    return async () => {
      const parts: string[] = [];
      for await (const part of source.exportText()) {
        parts.push(part);
      }
      return parts;
    };
  }, [sampleData]);
