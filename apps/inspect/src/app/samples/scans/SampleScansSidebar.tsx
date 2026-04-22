import clsx from "clsx";
import { FC, useMemo } from "react";

import type { Score } from "@tsmono/inspect-common/types";
import {
  inferValueType,
  ScannerResultDetailView,
  ScanResultInput,
} from "@tsmono/scout-components/scanner-result-detail";
import {
  metadataWithoutScannerKeys,
  resolveScannerResultView,
} from "@tsmono/scout-components/sentinels";

import { useEvalSpec } from "../../../state/hooks";
import { SampleScannerPicker } from "./SampleScannerPicker";
import styles from "./SampleScansSidebar.module.css";
import { buildScoreMarkdownRefs, MakeCiteUrl } from "./scanReferences";

interface SampleScansSidebarProps {
  scores: Record<string, Score>;
  makeCiteUrl: MakeCiteUrl;
  selected: string;
  onSelectedChange: (scanner: string) => void;
}

export const SampleScansSidebar: FC<SampleScansSidebarProps> = ({
  scores,
  makeCiteUrl,
  selected,
  onSelectedChange,
}) => {
  const scanners = Object.keys(scores);
  const score: Score | undefined = selected ? scores[selected] : undefined;

  const references = useMemo(
    () => buildScoreMarkdownRefs(score?.metadata ?? null, makeCiteUrl),
    [score?.metadata, makeCiteUrl]
  );

  const viewer = useEvalSpec()?.viewer;
  const config = useMemo(
    () => resolveScannerResultView(viewer, selected),
    [viewer, selected]
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
        onChange={onSelectedChange}
      />
    ) : scanners.length === 1 ? (
      <span className={clsx(styles.singleScanner, "text-size-smaller")}>
        {scanners[0]}
      </span>
    ) : null;

  return (
    <div className={styles.sidebar} aria-label="Sample scans">
      {header ? <div className={styles.header}>{header}</div> : null}
      <ScannerResultDetailView
        data={data}
        references={references}
        options={{ previewRefsOnHover: false }}
        config={config}
      />
    </div>
  );
};
