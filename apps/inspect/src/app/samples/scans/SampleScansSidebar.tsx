import clsx from "clsx";
import { FC, useEffect, useMemo, useState } from "react";

import type { Score } from "@tsmono/inspect-common/types";
import {
  inferValueType,
  ScannerResultDetailView,
  ScanResultInput,
} from "@tsmono/scout-components/scanner-result-detail";
import { metadataWithoutScannerKeys } from "@tsmono/scout-components/sentinels";

import { buildScoreMarkdownRefs, MakeCiteUrl } from "./scanReferences";
import { SampleScannerPicker } from "./SampleScannerPicker";
import styles from "./SampleScansSidebar.module.css";

interface SampleScansSidebarProps {
  scores: Record<string, Score>;
  makeCiteUrl: MakeCiteUrl;
}

export const SampleScansSidebar: FC<SampleScansSidebarProps> = ({
  scores,
  makeCiteUrl,
}) => {
  const scanners = Object.keys(scores);
  const [selected, setSelected] = useState<string>(scanners[0] ?? "");

  // If the currently selected scanner is no longer present (sample change),
  // clamp to the first available scanner.
  useEffect(() => {
    if (!scanners.includes(selected) && scanners.length > 0) {
      setSelected(scanners[0]);
    }
  }, [scanners, selected]);

  const score: Score | undefined = selected ? scores[selected] : undefined;

  const references = useMemo(
    () => buildScoreMarkdownRefs(score?.metadata ?? null, makeCiteUrl),
    [score?.metadata, makeCiteUrl],
  );

  if (!score) return null;

  const data: ScanResultInput = {
    value: score.value,
    valueType: inferValueType(score.value),
    answer: score.answer ?? undefined,
    explanation: score.explanation ?? undefined,
    metadata: metadataWithoutScannerKeys(score.metadata),
  };

  const header =
    scanners.length > 1 ? (
      <SampleScannerPicker
        scanners={scanners}
        selected={selected}
        onChange={setSelected}
      />
    ) : scanners.length === 1 ? (
      <span className={clsx(styles.singleScanner, "text-size-base")}>
        {scanners[0]}
      </span>
    ) : null;

  return (
    <div className={styles.sidebar} aria-label="Sample scans">
      <ScannerResultDetailView
        data={data}
        references={references}
        header={header}
        options={{ previewRefsOnHover: false }}
      />
    </div>
  );
};
