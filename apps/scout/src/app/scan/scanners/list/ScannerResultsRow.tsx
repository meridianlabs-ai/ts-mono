import clsx from "clsx";
import { FC, memo } from "react";
import { useSearchParams } from "react-router";

import { MarkdownReference } from "@tsmono/react/components";
import {
  Explanation,
  ValidationResult,
  Value,
} from "@tsmono/scout-components/scanner-result-detail";

import { useLoggingNavigate } from "../../../../debugging/navigationDebugging";
import { scanResultRoute } from "../../../../router/url";
import { useStore } from "../../../../state/store";
import { Error } from "../../../components/Error";
import { TaskName } from "../../../components/TaskName";
import { useScanRoute } from "../../../hooks/useScanRoute";
import { ScanResultSummary } from "../../../types";
import { useMarkdownRefs } from "../../../utils/refs";

import { GridDescriptor } from "./ScannerResultsList";
import styles from "./ScannerResultsRow.module.css";

interface ScannerResultsRowProps {
  index: number;
  summary: ScanResultSummary;
  gridDescriptor: GridDescriptor;
}

const ScannerResultsRowComponent: FC<ScannerResultsRowProps> = ({
  summary,
  gridDescriptor,
}) => {
  // Path information
  const { scansDir, scanPath } = useScanRoute();
  const [searchParams] = useSearchParams();

  // selected scan result
  const selectedScanResult = useStore((state) => state.selectedScanResult);
  const setSelectedScanResult = useStore(
    (state) => state.setSelectedScanResult
  );

  // Generate the route to the scan result using the current scan path and the entry's uuid
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const isNavigable = summary.identifier !== undefined && !!scansDir;
  const scanResultUrl = isNavigable
    ? scanResultRoute(scansDir, scanPath, summary.identifier, searchParams)
    : "";
  const navigate = useLoggingNavigate("ScannerResultsRow");

  // Information about the row
  const hasExplanation = gridDescriptor.columns.includes("result");
  const hasLabel = gridDescriptor.columns.includes("label");
  const hasErrors = gridDescriptor.columns.includes("error");
  const hasValidations = gridDescriptor.columns.includes("validations");

  // refs
  const refs: MarkdownReference[] = useMarkdownRefs(summary);

  // Task information
  const taskSet = summary.transcriptTaskSet;
  const taskId = summary.transcriptTaskId;
  const taskRepeat = summary.transcriptTaskRepeat;

  const selectRow = () => {
    if (summary.identifier) {
      setSelectedScanResult(summary.identifier);
    }
  };

  const grid = (
    <div
      style={gridDescriptor.gridStyle}
      className={clsx(
        styles.row,
        !isNavigable ? styles.disabled : "",
        selectedScanResult === summary.identifier ? styles.selected : "",
        hasExplanation ? "" : styles.noExplanation
      )}
      role="presentation"
      onClick={selectRow}
    >
      {hasExplanation && (
        <div className={clsx(styles.result, "text-size-smaller")}>
          <div className={clsx(styles.explanation, "text-size-smaller")}>
            <Explanation explanation={summary.explanation} references={refs} />
          </div>

          <div
            className={clsx(
              styles.id,
              "text-size-smallest",
              "text-style-secondary"
            )}
          >
            <TaskName
              taskSet={taskSet}
              taskId={taskId}
              taskRepeat={taskRepeat}
            />
            {` — `}
            {summary.transcriptModel || ""}
          </div>
        </div>
      )}
      {hasLabel && (
        <div
          className={clsx(
            styles.label,
            "text-size-smallest",
            "text-style-label",
            "text-style-secondary"
          )}
        >
          {summary.label || (
            <span className={clsx(styles.label, "text-style-secondary")}>
              —
            </span>
          )}
        </div>
      )}

      <div className={clsx("text-size-smaller")}>
        {!summary.scanError && (
          <Value
            value={summary.value}
            valueType={summary.valueType}
            identifier={summary.identifier}
            style="inline"
            references={refs}
          />
        )}
      </div>
      {hasValidations && (
        <div className={clsx("text-size-smaller")}>
          {summary.validationResult !== undefined && (
            <ValidationResult
              result={summary.validationResult}
              target={summary.validationTarget}
              label={summary.label}
            />
          )}
        </div>
      )}
      {hasErrors && (
        <div className={clsx(styles.error, "text-size-smallest")}>
          {summary.scanError && (
            <Error
              error={summary.scanError || "unknown error"}
              refusal={!!summary.scanErrorRefusal}
            />
          )}
        </div>
      )}
    </div>
  );

  const handleClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking an inner link
    if ((e.target as HTMLElement).closest("a")) {
      return;
    }
    if (!scanResultUrl) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    navigate(scanResultUrl);
  };

  // Keyboard activation runs the whole row gesture: mouse clicks reach the
  // inner grid first (selection) and then bubble out to navigation.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only the row itself: Enter on a link inside the row must navigate
    // that link, not get preventDefault()-ed into a row activation.
    if (e.target !== e.currentTarget) {
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }
    e.preventDefault();
    selectRow();
    if (scanResultUrl) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      navigate(scanResultUrl);
    }
  };

  // Non-navigable rows render dimmed with `cursor: default` — presented as
  // inert, so they get no tab stop to match.
  if (!isNavigable) {
    return grid;
  }

  return (
    <div
      className={clsx(styles.link)}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ cursor: "pointer" }}
    >
      {grid}
    </div>
  );
};

// memoize the component to avoid unnecessary re-renders (esp of things which may involve markdown rendering)
export const ScannerResultsRow = memo(ScannerResultsRowComponent);
