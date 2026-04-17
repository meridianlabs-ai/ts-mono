import clsx from "clsx";
import { FC, useEffect, useMemo, useState } from "react";

import type { Score } from "@tsmono/inspect-common/types";
import { MetaDataGrid } from "@tsmono/inspect-components/content";
import { MarkdownDivWithReferences } from "@tsmono/react/components";

import { SampleSummary } from "../../../client/api/types";

import { SampleScorerPicker } from "./SampleScorerPicker";
import { SampleScores } from "./SampleScores";
import styles from "./SampleScoresSidebar.module.css";
import {
  buildScoreMarkdownRefs,
  MakeCiteUrl,
  metadataWithoutScannerKeys,
} from "./scoreReferences";

interface SampleScoresSidebarProps {
  scores: Record<string, Score>;
  makeCiteUrl: MakeCiteUrl;
}

export const SampleScoresSidebar: FC<SampleScoresSidebarProps> = ({
  scores,
  makeCiteUrl,
}) => {
  const scorers = Object.keys(scores);
  const [selectedScorer, setSelectedScorer] = useState<string>(
    scorers[0] ?? "",
  );

  // If the currently selected scorer is no longer present (sample change),
  // clamp to the first available scorer.
  useEffect(() => {
    if (!scorers.includes(selectedScorer) && scorers.length > 0) {
      setSelectedScorer(scorers[0]);
    }
  }, [scorers, selectedScorer]);

  const scoreData = selectedScorer ? scores[selectedScorer] : undefined;

  const references = useMemo(
    () => buildScoreMarkdownRefs(scoreData?.metadata ?? null, makeCiteUrl),
    [scoreData?.metadata, makeCiteUrl],
  );

  // SampleScores takes a SampleSummary but only reads `.scores` off it —
  // pass a minimal shape instead of the whole sample.
  const scoresSampleShim = useMemo(
    () => ({ scores }) as unknown as SampleSummary,
    [scores],
  );

  const metadataEntries = metadataWithoutScannerKeys(scoreData?.metadata);
  const hasMetadata = Object.keys(metadataEntries).length > 0;

  return (
    <div className={styles.sidebar} aria-label="Sample scores">
      {scorers.length > 1 ? (
        <div className={styles.section}>
          <SampleScorerPicker
            scorers={scorers}
            selectedScorer={selectedScorer}
            onChange={setSelectedScorer}
          />
        </div>
      ) : scorers.length === 1 ? (
        <div
          className={clsx(
            styles.section,
            styles.singleScorer,
            "text-size-base",
          )}
        >
          {scorers[0]}
        </div>
      ) : null}

      {scoreData ? (
        <>
          <div className={styles.section}>
            <div className={clsx(styles.sectionLabel, labelClasses)}>Score</div>
            <div className={clsx("text-size-base")}>
              <SampleScores
                sample={scoresSampleShim}
                scorer={selectedScorer}
              />
            </div>
          </div>

          {scoreData.answer ? (
            <div className={styles.section}>
              <div className={clsx(styles.sectionLabel, labelClasses)}>
                Answer
              </div>
              <div className={clsx("text-size-base")}>{scoreData.answer}</div>
            </div>
          ) : null}

          {scoreData.explanation ? (
            <div className={styles.section}>
              <div className={clsx(styles.sectionLabel, labelClasses)}>
                Explanation
              </div>
              <MarkdownDivWithReferences
                markdown={scoreData.explanation}
                references={references}
                options={{ previewRefsOnHover: false }}
                className={clsx("text-size-base")}
              />
            </div>
          ) : null}

          {hasMetadata ? (
            <div className={styles.section}>
              <div className={clsx(styles.sectionLabel, labelClasses)}>
                Metadata
              </div>
              <MetaDataGrid
                entries={metadataEntries}
                references={references}
                options={{ previewRefsOnHover: false }}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

const labelClasses = [
  "text-size-smaller",
  "text-style-label",
  "text-style-secondary",
];
