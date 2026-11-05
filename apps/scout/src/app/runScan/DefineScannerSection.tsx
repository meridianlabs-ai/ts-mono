import {
  VscodeButton,
  VscodeLabel,
  VscodeOption,
  VscodeSingleSelect,
} from "@vscode-elements/react-elements";
import { FC, useState } from "react";

import { Icon } from "@tsmono/react/icons";

import { ScansNavbar } from "../components/ScansNavbar";
import { TranscriptsNavbar } from "../components/TranscriptsNavbar";
import { useTranscriptsFilterBarProps } from "../hooks/useTranscriptsFilterBarProps";
import { useAppConfig } from "../server/useAppConfig";
import { useScanners } from "../server/useScanners";
import { useStartScan } from "../server/useStartScan";
import { TranscriptFilterBar } from "../transcripts/TranscriptFilterBar";
import { eventValue } from "../utils/formEvents";
import { useScansDir } from "../utils/useScansDir";
import { useTranscriptsDir } from "../utils/useTranscriptsDir";

import styles from "./DefineScannerSection.module.css";
import {
  defaultJevParams,
  jevScannerParams,
  ScannerParamsResult,
} from "./jevParams";
import { JevScannerParams } from "./JevScannerParams";
import { LlmScannerParams, LlmScannerParamsValue } from "./LlmScannerParams";
import { ScannerParamsPlaceholder } from "./ScannerParamsPlaceholder";
import { errorSummary } from "./startScanError";

function getSelectValue(e: Event): string {
  return eventValue(e);
}

const kLlmScanner = "inspect_scout/llm_scanner";
const kJevScanner = "inspect_scout/jev_scanner";

interface Props {
  onScanStarted: (scanId: string) => void;
}

const defaultLlmParams: LlmScannerParamsValue = {
  question: "",
  answerType: "boolean",
  excludeSystem: true,
  excludeReasoning: false,
  excludeToolUsage: false,
};

export const DefineScannerSection: FC<Props> = ({ onScanStarted }) => {
  const [selectedScanner, setSelectedScanner] = useState<string | null>(null);
  const [llmParams, setLlmParams] = useState(defaultLlmParams);
  const [jevParams, setJevParams] = useState(defaultJevParams);
  const { loading, data: scanners } = useScanners();
  const mutation = useStartScan();

  const config = useAppConfig();
  const filter = Array.isArray(config.filter)
    ? config.filter.join(" ")
    : config.filter;

  const {
    displayTranscriptsDir,
    resolvedTranscriptsDir,
    resolvedTranscriptsDirSource,
    setTranscriptsDir,
  } = useTranscriptsDir(true);
  const { displayScansDir, resolvedScansDirSource, setScansDir } =
    useScansDir(true);

  const { filterCodeValues, filterSuggestions, onFilterColumnChange } =
    useTranscriptsFilterBarProps(resolvedTranscriptsDir);

  const effectiveScanner = selectedScanner ?? scanners?.[0]?.name;
  const selectedScannerInfo = scanners?.find(
    (s) => s.name === effectiveScanner
  );
  const scannerParams = ((): ScannerParamsResult | null => {
    if (effectiveScanner === kLlmScanner) {
      return llmParams.question.trim().length > 0
        ? {
            ok: true,
            params: {
              question: llmParams.question,
              answer: llmParams.answerType,
              preprocessor: {
                exclude_system: llmParams.excludeSystem,
                exclude_reasoning: llmParams.excludeReasoning,
                exclude_tool_usage: llmParams.excludeToolUsage,
              },
            },
          }
        : { ok: false, error: "Enter a question." };
    }
    if (effectiveScanner === kJevScanner) {
      return jevScannerParams(jevParams);
    }
    return null;
  })();
  const canRunScan = scannerParams?.ok === true && !mutation.isPending;
  // Validation hints wait until a question is typed, so a fresh form isn't
  // greeted with an error.
  const question =
    effectiveScanner === kJevScanner ? jevParams.question : llmParams.question;
  const validationHint =
    scannerParams?.ok === false && question.trim() ? scannerParams.error : null;

  const handleRunScan = () => {
    if (!effectiveScanner || scannerParams?.ok !== true) {
      return;
    }
    mutation.mutate(
      {
        name: effectiveScanner,
        filter: [],
        limit: 100,
        scanners: [
          {
            name: effectiveScanner,
            version: 0,
            params: scannerParams.params,
          },
        ],
      },
      { onSuccess: (data) => onScanStarted(data.spec.scan_id) }
    );
  };

  return (
    <>
      <TranscriptsNavbar
        transcriptsDir={displayTranscriptsDir}
        transcriptsDirSource={resolvedTranscriptsDirSource}
        filter={filter}
        setTranscriptsDir={setTranscriptsDir}
      />
      <TranscriptFilterBar
        filterCodeValues={filterCodeValues}
        filterSuggestions={filterSuggestions}
        onFilterColumnChange={onFilterColumnChange}
        includeColumnPicker={false}
      />
      <ScansNavbar
        scansDir={displayScansDir}
        setScansDir={setScansDir}
        scansDirSource={resolvedScansDirSource}
      />

      <div className={styles.defineScannerSection}>
        <h2 className={styles.sectionTitle}>Define Scanner</h2>

        {/* Scanner Selection */}
        <div className={styles.formGroup}>
          <VscodeLabel>Type</VscodeLabel>
          <div className={styles.scannerRow}>
            <VscodeSingleSelect
              value={effectiveScanner ?? ""}
              onChange={(e) => {
                setSelectedScanner(getSelectValue(e));
                mutation.reset();
              }}
              disabled={loading}
            >
              {scanners?.map((s) => (
                <VscodeOption key={s.name} value={s.name}>
                  {s.name}
                </VscodeOption>
              ))}
            </VscodeSingleSelect>
            {selectedScannerInfo?.description && (
              <div className={styles.scannerDescription}>
                {selectedScannerInfo.description}
              </div>
            )}
          </div>
        </div>

        {/* Scanner Params */}
        {effectiveScanner === kLlmScanner ? (
          <LlmScannerParams value={llmParams} onChange={setLlmParams} />
        ) : effectiveScanner === kJevScanner ? (
          <JevScannerParams value={jevParams} onChange={setJevParams} />
        ) : effectiveScanner ? (
          <ScannerParamsPlaceholder scannerName={effectiveScanner} />
        ) : null}

        {/* Run Button */}
        <div className={styles.runScanRow}>
          <VscodeButton disabled={!canRunScan} onClick={handleRunScan}>
            <Icon name="play" />
            Run Scan
          </VscodeButton>
          <div className={styles.mutationStatus}>
            {validationHint ??
              (mutation.isError
                ? `start scan failed: ${errorSummary(mutation.error.message)}`
                : `start scan status: ${mutation.status}`)}
          </div>
        </div>
      </div>
    </>
  );
};
