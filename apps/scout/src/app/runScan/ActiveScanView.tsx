import { skipToken } from "@tanstack/react-query";
import { clsx } from "clsx";
import { FC, ReactNode, useState } from "react";
import { Link } from "react-router";

import {
  ErrorPanel,
  LoadingBar,
  NoContentsPanel,
} from "@tsmono/react/components";
import { useInterval } from "@tsmono/react/hooks";
import { Icon } from "@tsmono/react/icons";
import { basename, dirname, getOwn, join } from "@tsmono/util";

import { scanRoute } from "../../router/url";
import {
  ActiveScanInfo,
  ScannerSummary,
  Status,
  Summary,
  ValidationResults,
} from "../../types/api-types";
import { useActiveScan } from "../server/useActiveScan";
import { useFinishedScan } from "../server/useFinishedScan";

import styles from "./ActiveScanView.module.css";

const formatMemory = (bytes: number): string => {
  const gb = bytes / (1024 * 1024 * 1024);
  const formatted = gb.toFixed(1).replace(/\.?0+$/, "");
  return `${formatted} GB`;
};

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * Get validation accuracy from pre-computed ValidationResults.
 */
const getValidationScore = (
  validation: ValidationResults | null | undefined
): number | null => {
  if (validation?.metrics?.accuracy == null) return null;
  return validation.metrics.accuracy;
};

const getFirstMetricValue = (
  metrics: Record<string, Record<string, number>> | null
): number | null => {
  if (!metrics) return null;
  const firstNested = Object.values(metrics)[0];
  if (!firstNested) return null;
  return Object.values(firstNested)[0] ?? null;
};

const getMetricLabel = (scanners: Record<string, ScannerSummary>): string => {
  const names = new Set<string>();
  for (const scanner of Object.values(scanners)) {
    if (scanner.metrics) {
      const firstNested = Object.values(scanner.metrics)[0];
      if (firstNested) {
        const firstKey = Object.keys(firstNested)[0];
        if (firstKey) names.add(firstKey);
      }
    }
  }
  return names.size === 1 ? ([...names][0] ?? "metric") : "metric";
};

const ScannerTable: FC<{
  scannerNames: string[];
  summary: Summary;
}> = ({ scannerNames, summary }) => {
  // Check if any scanner has validations or metrics (use scanner_names for iteration)
  const hasValidations = scannerNames.some(
    (name) =>
      (getOwn(summary.scanners, name)?.validation?.entries.length ?? 0) > 0
  );
  const hasMetrics = scannerNames.some(
    (name) => getOwn(summary.scanners, name)?.metrics !== null
  );
  const metricLabel = hasMetrics ? getMetricLabel(summary.scanners) : "";
  const hasUnscored = scannerNames.some(
    (name) => (getOwn(summary.scanners, name)?.unscored ?? 0) > 0
  );

  // Calculate scanner stats (iterate over scanner_names to show all rows from start)
  const scannerStats = scannerNames.map((name) => {
    const scanner = getOwn(summary.scanners, name);
    const totalTokens = scanner
      ? Object.values(scanner.model_usage).reduce<number>(
          (sum, usage) => sum + usage.total_tokens,
          0
        )
      : 0;
    const tokensPerScan =
      scanner && scanner.scans > 0
        ? Math.round(totalTokens / scanner.scans)
        : 0;
    const validationScore = scanner
      ? getValidationScore(scanner.validation)
      : null;
    const metricValue = scanner
      ? getFirstMetricValue(scanner.metrics ?? null)
      : null;
    return {
      name,
      scanner,
      totalTokens,
      tokensPerScan,
      validationScore,
      metricValue,
    };
  });

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>scanner</th>
          {hasMetrics && <th className={styles.numeric}>{metricLabel}</th>}
          {hasValidations && <th className={styles.numeric}>validation</th>}
          <th className={styles.numeric}>results</th>
          {hasUnscored && <th className={styles.numeric}>unscored</th>}
          <th className={styles.numeric}>errors</th>
          <th className={styles.numeric}>tokens/scan</th>
          <th className={styles.numeric}>tokens</th>
        </tr>
      </thead>
      <tbody>
        {scannerStats.map(
          ({
            name,
            scanner,
            totalTokens,
            tokensPerScan,
            validationScore,
            metricValue,
          }) => (
            <tr key={name}>
              <td>{name}</td>
              {hasMetrics && (
                <td className={styles.numeric}>
                  {metricValue !== null
                    ? metricValue === Math.floor(metricValue)
                      ? metricValue.toLocaleString()
                      : metricValue.toFixed(2)
                    : "-"}
                </td>
              )}
              {hasValidations && (
                <td className={styles.numeric}>
                  {validationScore !== null ? validationScore.toFixed(2) : "-"}
                </td>
              )}
              <td className={styles.numeric}>{scanner?.results || "-"}</td>
              {hasUnscored && (
                <td className={styles.numeric}>{scanner?.unscored || "-"}</td>
              )}
              <td className={styles.numeric}>{scanner?.errors || "-"}</td>
              <td className={styles.numeric}>
                {tokensPerScan ? tokensPerScan.toLocaleString() : "-"}
              </td>
              <td className={styles.numeric}>
                {totalTokens ? totalTokens.toLocaleString() : "-"}
              </td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
};

const CardHeader: FC<{
  title: string;
  config?: string;
  children?: ReactNode;
}> = ({ title, config, children }) => (
  <div className={styles.header}>
    <div>
      <span className={styles.scanId}>{title}</span>
      {config && <div className={styles.configLine}>{config}</div>}
    </div>
    {children}
  </div>
);

const ActiveScanCard: FC<{ info: ActiveScanInfo }> = ({ info }) => {
  const { metrics, summary } = info;
  const [now, setNow] = useState(() => Date.now());

  // Update time every second for elapsed/remaining
  useInterval(() => setNow(Date.now()), 1000);

  // Progress calculations
  const completed = metrics.completed_scans;
  const total = info.total_scans;
  const progressPct = total > 0 ? (completed / total) * 100 : 0;
  const elapsedSec = info.start_time > 0 ? now / 1000 - info.start_time : 0;
  const remainingSec =
    completed > 0 && total > completed
      ? (elapsedSec / completed) * (total - completed)
      : 0;

  // Batch processing
  const hasBatch = metrics.batch_oldest_created !== null;
  const batchAge = hasBatch
    ? Math.floor(now / 1000 - (metrics.batch_oldest_created ?? 0))
    : 0;

  return (
    <div className={styles.card}>
      <CardHeader
        title={info.title || `scan: ${info.scan_id}`}
        config={info.config}
      />

      {total > 0 && (
        <div className={styles.progressSection}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className={styles.progressStats}>
            <span>
              {completed.toLocaleString()}/{total.toLocaleString()}
            </span>
            <span>{formatDuration(elapsedSec)}</span>
            {remainingSec > 0 && <span>{formatDuration(remainingSec)}</span>}
          </div>
        </div>
      )}

      <div className={styles.content}>
        <div className={styles.mainSection}>
          <ScannerTable scannerNames={info.scanner_names} summary={summary} />
        </div>

        <div className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <div className={styles.sidebarTitle}>workers</div>
            <div className={styles.stat}>
              <span>parsing:</span>
              <span>{metrics.tasks_parsing}</span>
            </div>
            <div className={styles.stat}>
              <span>scanning:</span>
              <span>{metrics.tasks_scanning}</span>
            </div>
            <div className={styles.stat}>
              <span>idle:</span>
              <span>{metrics.tasks_idle}</span>
            </div>
            <div className={styles.stat}>
              <span>memory:</span>
              <span>{formatMemory(metrics.memory_usage)}</span>
            </div>
          </div>

          {hasBatch && (
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarTitle}>batch processing</div>
              <div className={styles.stat}>
                <span>pending:</span>
                <span>{metrics.batch_pending.toLocaleString()}</span>
              </div>
              {metrics.batch_failures > 0 && (
                <div className={styles.stat}>
                  <span>failures:</span>
                  <span className={styles.error}>
                    {metrics.batch_failures.toLocaleString()}
                  </span>
                </div>
              )}
              <div className={styles.stat}>
                <span>max age:</span>
                <span>{formatDuration(batchAge)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Outstanding errors. Not the scanner counters, which keep counting errors a
// resumed scan has since retried.
const errorCount = (status: Status): number => status.errors.length;

const plural = (count: number, noun: string): string =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The card a started scan settles into once it leaves the active list: the
 * same header and scanner table, filled from the scan's final status. The
 * progress bar, clock and worker stats are dropped because the final status
 * doesn't report them.
 */
const FinishedScanCard: FC<{
  status: Status;
  /** The last active-list entry seen for this scan, if it was ever listed. */
  lastActive: ActiveScanInfo | undefined;
  resultsHref: string;
}> = ({ status, lastActive, resultsHref }) => {
  const errors = errorCount(status);
  // The summary names every scanner once it's written; until then, use the
  // last active entry's names so the rows don't vanish.
  const summarized = Object.keys(status.summary.scanners);
  const scannerNames =
    summarized.length > 0 ? summarized : (lastActive?.scanner_names ?? []);
  // Scout leaves a scan with errors incomplete so it can be resumed.
  const outcome = status.complete ? "Complete" : "Incomplete";
  return (
    <div className={styles.card}>
      <CardHeader
        title={lastActive?.title || `scan: ${status.spec.scan_id}`}
        config={lastActive?.config}
      >
        <div className={styles.outcome}>
          <span
            role="status"
            className={clsx(
              styles.outcomeLabel,
              errors > 0
                ? styles.failed
                : status.complete
                  ? styles.succeeded
                  : undefined
            )}
          >
            {(errors > 0 || status.complete) && (
              <Icon name={errors > 0 ? "error" : "success"} />
            )}
            {errors > 0 ? `${outcome} · ${plural(errors, "error")}` : outcome}
          </span>
          <Link to={resultsHref} className={styles.resultsLink}>
            View results
            <Icon name="arrowRight" />
          </Link>
        </div>
      </CardHeader>
      <ScannerTable scannerNames={scannerNames} summary={status.summary} />
    </div>
  );
};

// The server reports a started scan's location relative to its working
// directory, the project dir, which is also where the scan subprocess runs.
const startedScanLocation = (location: string, projectDir: string) => {
  const absolute = /^([a-z][a-z\d+.-]*:\/\/|\/)/i.test(location)
    ? location
    : join(location, projectDir);
  return { scansDir: dirname(absolute), scanPath: basename(absolute) };
};

interface Props {
  /** The scan this page started; key the view by its id to reset per scan. */
  scan: Status | undefined;
  /** The server's working directory, which started scans' locations are relative to. */
  projectDir: string;
}

export const ActiveScanView: FC<Props> = ({ scan, projectDir }) => {
  const { loading, error, data: scanInfo } = useActiveScan(scan?.spec.scan_id);

  // Until the scan has been listed once, its absence may only mean the
  // active-scans poll hasn't picked it up yet. The last entry also titles the
  // finished card.
  const [lastActive, setLastActive] = useState<ActiveScanInfo>();
  if (scanInfo && scanInfo !== lastActive) setLastActive(scanInfo);
  const seenActive = lastActive !== undefined;

  const started = scan
    ? startedScanLocation(scan.location, projectDir)
    : undefined;
  const notActive = !!scan && !loading && !error && !scanInfo;

  // The final status on screen. Kept in state so a failed poll or a failed
  // active-scans request doesn't take the card away.
  const [shown, setShown] = useState<Status>();
  const { error: statusError, data: finalStatus } = useFinishedScan(
    (notActive || shown) && started ? started : skipToken
  );
  // Before the scan has been listed, an incomplete status without errors may
  // only mean it hasn't started yet; one with errors means it failed early.
  if (
    finalStatus &&
    finalStatus !== shown &&
    (shown || finalStatus.complete || seenActive || errorCount(finalStatus) > 0)
  ) {
    setShown(finalStatus);
  }
  // A resumed scan is live again; its earlier final status no longer holds.
  if (scanInfo && shown) setShown(undefined);

  return (
    <div className={styles.scansList}>
      <LoadingBar
        loading={
          !!scan &&
          (!!loading || (seenActive && notActive && !shown && !statusError))
        }
      />
      {error && (
        <ErrorPanel
          title="Error Loading Active Scan"
          error={{ message: error.message }}
        />
      )}
      {statusError && !shown && (
        <ErrorPanel
          title="Error Loading Scan Results"
          error={{ message: statusError.message }}
        />
      )}
      {!scan && !error && (
        <NoContentsPanel icon="running" text="No scan started" />
      )}
      {notActive && !seenActive && !shown && !statusError && (
        <NoContentsPanel icon="running" text="Scan not found" />
      )}
      {scanInfo ? (
        <ActiveScanCard info={scanInfo} />
      ) : (
        shown &&
        started && (
          <FinishedScanCard
            status={shown}
            lastActive={lastActive}
            resultsHref={scanRoute(started.scansDir, started.scanPath)}
          />
        )
      )}
    </div>
  );
};
