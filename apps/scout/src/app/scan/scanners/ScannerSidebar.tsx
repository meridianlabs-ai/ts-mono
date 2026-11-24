import clsx from "clsx";
import { FC, Fragment, useCallback, useRef } from "react";
import { useSearchParams } from "react-router";

import { LabeledValue } from "@tsmono/react/components";
import { IconName } from "@tsmono/react/icons";
import { VirtualList } from "@tsmono/react/virtual";
import type { VirtualListHandle } from "@tsmono/react/virtual";
import { formatPercent, formatPrettyDecimal, getOwn } from "@tsmono/util";

import { updateScannerParam } from "../../../router/url";
import { useStore } from "../../../state/store";
import { Status, ValidationResults } from "../../../types/api-types";
import { useSelectedScanner } from "../../hooks/useSelectedScanner";

import styles from "./ScannerSidebar.module.css";

export const ScannerSidebar: FC<{ selectedScan: Status }> = ({
  selectedScan,
}) => {
  const entries = toEntries(selectedScan);

  const scanListHandle = useRef<VirtualListHandle | null>(null);
  const renderRow = useCallback(
    (index: number, entry: ScanResultsOutlineEntry) => {
      return <ScanResultsRow index={index} entry={entry} />;
    },
    []
  );

  return (
    <div className={clsx(styles.container)}>
      <VirtualList<ScanResultsOutlineEntry>
        persistenceKey={"scans-toc-list"}
        ref={scanListHandle}
        data={entries}
        renderRow={renderRow}
        itemSearchText={entrySearchText}
      />
    </div>
  );
};

const ScanResultsRow: FC<{ index: number; entry: ScanResultsOutlineEntry }> = ({
  index,
  entry,
}) => {
  const { data: selectedScanner } = useSelectedScanner();
  const setSelectedScanner = useStore((state) => state.setSelectedScanner);
  const [searchParams, setSearchParams] = useSearchParams();
  const handleClick = useCallback(
    (title: string) => {
      setSelectedScanner(title);
      setSearchParams(updateScannerParam(searchParams, title), {
        replace: true,
      });
    },
    [setSelectedScanner, searchParams, setSearchParams]
  );

  return (
    <button
      type="button"
      className={clsx(
        styles.entry,
        selectedScanner === entry.title ? styles.selected : ""
      )}
      key={index}
      aria-current={selectedScanner === entry.title ? "true" : undefined}
      onClick={() => {
        handleClick(entry.title);
      }}
    >
      <div className={clsx(styles.titleBlock)}>
        <div className={clsx("text-size-large", styles.title)}>
          {entry.title}
        </div>
        {entry.params && entry.params.length > 0 && (
          <div className={clsx("text-size-smallest", styles.subTitle)}>
            {entry.params.join("")}
          </div>
        )}
      </div>

      <LabeledValue
        label="Positive Results"
        layout="row"
        className={clsx("text-size-smallest", styles.contents)}
      >
        {entry.results}
      </LabeledValue>

      {entry.unscored > 0 && (
        <LabeledValue
          label="Unscored"
          layout="row"
          className={clsx("text-size-smallest", styles.contents)}
        >
          {entry.unscored}
        </LabeledValue>
      )}

      {Object.keys(entry.metrics).length > 0 && (
        <MetricsDisplay metrics={entry.metrics} scannerName={entry.title} />
      )}

      {!!entry.errors && (
        <LabeledValue
          label="Errors"
          layout="row"
          className={clsx("text-size-smallest", styles.contents)}
        >
          {entry.errors}
        </LabeledValue>
      )}

      {entry.validations !== undefined && (
        <LabeledValue
          label="Validation"
          layout="column"
          className={clsx("text-size-smallest", styles.validations)}
        >
          <NumericResultsTable
            results={entry.validations}
            formatter={(value) => formatPercent(value, 1)}
          />
        </LabeledValue>
      )}
    </button>
  );
};

// One string per rendered block: Find never matches across blocks.
const entrySearchText = (entry: ScanResultsOutlineEntry): string[] => {
  const texts = [entry.title];
  if (entry.params && entry.params.length > 0) {
    texts.push(entry.params.join(""));
  }
  texts.push("Positive Results", String(entry.results));
  if (entry.unscored > 0) {
    texts.push("Unscored", String(entry.unscored));
  }
  const metricKeys = Object.keys(entry.metrics);
  if (metricKeys.length > 0) {
    texts.push("Metrics");
    if (metricKeys.length === 1 && metricKeys[0] === entry.title) {
      texts.push(
        ...numericResultsText(
          entry.metrics[entry.title] ?? {},
          formatPrettyDecimal
        )
      );
    } else {
      for (const label of metricKeys) {
        texts.push(
          label,
          ...numericResultsText(entry.metrics[label] ?? {}, formatPrettyDecimal)
        );
      }
    }
  }
  if (entry.errors) {
    texts.push("Errors", String(entry.errors));
  }
  if (entry.validations !== undefined) {
    texts.push(
      "Validation",
      ...numericResultsText(entry.validations, (value) =>
        formatPercent(value, 1)
      )
    );
  }
  return texts;
};

const numericResultsText = (
  results: Record<string, number>,
  formatter: (value: number) => string
): string[] =>
  Object.entries(results).flatMap(([key, value]) => [key, formatter(value)]);

interface ScanResultsOutlineEntry {
  icon?: IconName;
  title: string;
  tokens?: number;
  results: number;
  unscored: number;
  scans: number;
  validations?: Record<string, number>;
  errors?: number;
  params?: string[];
  metrics: Record<string, Record<string, number>>;
}

const toEntries = (status?: Status): ScanResultsOutlineEntry[] => {
  if (!status) {
    return [];
  }
  const entries: ScanResultsOutlineEntry[] = [];
  const scanners = status.summary.scanners;
  for (const scanner of Object.keys(scanners)) {
    // The summary
    const summary = scanners[scanner];

    // The configuration
    const scanInfo = getOwn(status.spec.scanners, scanner);

    const formattedParams: string[] = [];
    if (scanInfo) {
      for (const [key, value] of Object.entries(scanInfo.params)) {
        formattedParams.push(`${key}=${JSON.stringify(value)}`);
      }
    }

    const validations = resolveValidations(summary?.validation);

    const metrics: Record<string, Record<string, number>> = {};
    if (summary?.metrics) {
      if (Object.keys(summary.metrics).includes(scanner)) {
        // Pattern 1: global — { scanner_name: { metric: value, ... } }
        metrics[scanner] = summary.metrics[scanner] ?? {};
      } else {
        // Pattern 2: label-based — { label: { metric: value, ... }, ... }
        for (const [key, value] of Object.entries(summary.metrics)) {
          metrics[key] = value;
        }
      }
    }

    entries.push({
      icon: "scorer",
      title: scanner,
      results: summary?.results || 0,
      unscored: summary?.unscored ?? 0,
      scans: summary?.scans || 0,
      tokens: summary?.tokens,
      errors: summary?.errors,
      params: formattedParams,
      validations: validations,
      metrics,
    });
  }
  return entries;
};

/**
 * Extract validation metrics from pre-computed ValidationResults.
 */
const resolveValidations = (
  validation: ValidationResults | undefined | null
): Record<string, number> | undefined => {
  if (!validation?.metrics) {
    return undefined;
  }

  const m = validation.metrics;
  const result: Record<string, number> = {};

  // Add metrics in display order: accuracy, precision, recall, f1
  if (m.accuracy !== null) {
    result["accuracy"] = m.accuracy;
  }
  if (m.precision !== null) {
    result["precision"] = m.precision;
  }
  if (m.recall !== null) {
    result["recall"] = m.recall;
  }
  if (m.f1 !== null) {
    result["f1"] = m.f1;
  }

  // Return undefined if we couldn't extract any metrics
  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
};

const MetricsDisplay: FC<{
  metrics: Record<string, Record<string, number>>;
  scannerName: string;
}> = ({ metrics, scannerName }) => {
  const keys = Object.keys(metrics);
  if (keys.length === 1 && keys[0] === scannerName) {
    // Pattern 1: global metrics — show inner values directly
    return (
      <LabeledValue
        label="Metrics"
        layout="column"
        className={clsx("text-size-smallest", styles.validations)}
      >
        <NumericResultsTable
          results={metrics[scannerName] ?? {}}
          formatter={(value) => formatPrettyDecimal(value)}
        />
      </LabeledValue>
    );
  }
  // Pattern 2: label-based metrics — show each label with its values
  return (
    <LabeledValue
      label="Metrics"
      layout="column"
      className={clsx("text-size-smallest", styles.validations)}
    >
      {keys.map((label) => (
        <LabeledValue
          key={label}
          label={label}
          layout="column"
          className={clsx("text-size-smallest", styles.validations)}
        >
          <NumericResultsTable
            results={metrics[label] ?? {}}
            formatter={(value) => formatPrettyDecimal(value)}
          />
        </LabeledValue>
      ))}
    </LabeledValue>
  );
};

const NumericResultsTable: FC<{
  results: Record<string, number>;
  maxrows?: number;
  formatter?: (value: number) => string;
}> = ({ results: validations, formatter }) => {
  return (
    <div className={clsx(styles.numericResultTable)}>
      {Object.entries(validations).map(([key, value]) => (
        <Fragment key={key}>
          <div>{key}</div>
          <div>{formatter ? formatter(value) : value}</div>
        </Fragment>
      ))}
    </div>
  );
};
