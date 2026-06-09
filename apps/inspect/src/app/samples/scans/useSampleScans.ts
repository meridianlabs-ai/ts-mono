import { useEffect, useMemo, useState } from "react";

import type { Score } from "@tsmono/inspect-common/types";
import type { EventNodeContext } from "@tsmono/inspect-components/transcript";
import {
  isScannerScore,
  readScannerReferences,
} from "@tsmono/scout-components/sentinels";

import { useMakeCiteUrl, type MakeCiteUrl } from "./scanReferences";

export interface SampleScans {
  /** Scanner-produced scores only (non-scanner scores belong in the Scoring tab). */
  scores: Record<string, Score>;
  hasScans: boolean;
  selected: string;
  setSelected: (scanner: string) => void;
  makeCiteUrl: MakeCiteUrl;
  /** Message cite labels for the selected scanner, gated on `open`. */
  eventNodeContext: Partial<EventNodeContext> | undefined;
}

/**
 * Owns the scanner-scores concern for a sample: filters to scanner scores,
 * tracks the selected scanner, and derives the transcript cite-label context.
 * `open` mirrors the scans sidebar's visibility — labels are only computed
 * while the sidebar is showing.
 */
export function useSampleScans(opts: {
  allScores?: Record<string, Score> | null;
  sampleId?: string | number;
  sampleEpoch?: number;
  open: boolean;
}): SampleScans {
  const { allScores, sampleId, sampleEpoch, open } = opts;

  const scores = useMemo(() => {
    const filtered: Record<string, Score> = {};
    if (allScores) {
      for (const [key, score] of Object.entries(allScores)) {
        if (isScannerScore(score.metadata)) {
          filtered[key] = score;
        }
      }
    }
    return filtered;
  }, [allScores]);

  const hasScans = Object.keys(scores).length > 0;

  const [selected, setSelected] = useState<string>("");
  useEffect(() => {
    const scanners = Object.keys(scores);
    if (scanners.length === 0) {
      if (selected !== "") setSelected("");
    } else if (!scanners.includes(selected)) {
      setSelected(scanners[0]);
    }
  }, [scores, selected]);

  const makeCiteUrl = useMakeCiteUrl({ sampleId, sampleEpoch });

  const eventNodeContext = useMemo<
    Partial<EventNodeContext> | undefined
  >(() => {
    if (!open || !hasScans) return undefined;
    const score = selected ? scores[selected] : undefined;
    const refs = readScannerReferences(score?.metadata);
    const messageLabels: Record<string, string> = {};
    for (const r of refs) {
      if (r.type === "message" && r.id && r.cite) {
        messageLabels[r.id] = r.cite;
      }
    }
    return Object.keys(messageLabels).length > 0
      ? { messageLabels }
      : undefined;
  }, [open, hasScans, scores, selected]);

  return {
    scores,
    hasScans,
    selected,
    setSelected,
    makeCiteUrl,
    eventNodeContext,
  };
}
