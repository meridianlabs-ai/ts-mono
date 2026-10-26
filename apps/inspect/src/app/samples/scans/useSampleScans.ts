import { useMemo, useState } from "react";

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
  /** At least one scanner found something (see `hasScanResults`). */
  hasResults: boolean;
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

  const scanners = Object.keys(scores);
  const hasScans = scanners.length > 0;
  const hasResults = hasScanResults(scores);

  // Derive the effective selection instead of syncing state in an effect:
  // fall back to the first scanner when the stored choice isn't available.
  const [storedSelection, setSelected] = useState<string>("");
  const selected = scanners.includes(storedSelection)
    ? storedSelection
    : (scanners[0] ?? "");

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
    hasResults,
    selected,
    setSelected,
    makeCiteUrl,
    eventNodeContext,
  };
}

/**
 * Whether any scanner produced a result worth showing. A scanner whose value
 * is falsy (no value/NaN, false, 0, "", or an empty list/dict) and that cites
 * nothing found nothing, so on its own isn't worth opening the Scans panel for
 * by default.
 */
export const hasScanResults = (scores: Record<string, Score>): boolean =>
  Object.values(scores).some(
    (score) =>
      !isFalsyValue(score.value) ||
      readScannerReferences(score.metadata).length > 0
  );

const isFalsyValue = (value: Score["value"]): boolean =>
  Array.isArray(value)
    ? value.length === 0
    : typeof value === "object"
      ? Object.keys(value).length === 0
      : !value;
