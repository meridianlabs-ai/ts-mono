import clsx from "clsx";
import { FC, useState } from "react";
import { createPortal } from "react-dom";

import { EvalResults, EvalSpec } from "@tsmono/inspect-common/types";
import { formatPrettyDecimal } from "@tsmono/util";

import { EvalLogStatus } from "../../../@types/extraInspect";
import { RunningMetric } from "../../../client/api/types";
import { LinkButton } from "../../../components/LinkButton";
import { Modal } from "../../../components/Modal";
import { kModelNone } from "../../../constants";
import {
  expandGroupedMetrics,
  metricDisplayName,
  toDisplayScorers,
} from "../../../scoring/metrics";
import { groupScorers } from "../../../scoring/scores";
import { ApplicationIcons } from "../../appearance/icons";

import styles from "./CollapsedTitleBar.module.css";
import { displayScorersFromRunningMetrics } from "./ResultsPanel";
import { ScoreAgGrid } from "./ScoreAgGrid";

const kInlineMetricLimit = 2;

interface CollapsedTitleBarProps {
  evalSpec?: EvalSpec;
  evalResults?: EvalResults | null;
  runningMetrics?: RunningMetric[];
  status?: EvalLogStatus;
  sampleCount?: number;
}

export const CollapsedTitleBar: FC<CollapsedTitleBarProps> = ({
  evalSpec,
  evalResults,
  runningMetrics,
  status,
  sampleCount,
}) => {
  const showMetrics =
    status === "success" ||
    (status === "started" && (runningMetrics?.length ?? 0) > 0) ||
    (status === "error" && evalSpec?.config["continue_on_fail"]);

  const scorers = runningMetrics
    ? displayScorersFromRunningMetrics(runningMetrics)
    : toDisplayScorers(evalResults?.scores);

  const expandedScorers = expandGroupedMetrics(scorers ?? []);
  const totalMetrics = expandedScorers.reduce(
    (n, s) => n + s.metrics.length,
    0
  );

  const modelText = formatModelText(evalSpec);

  return (
    <div
      className={clsx("navbar-brand", "navbar-text", "mb-0", styles.container)}
    >
      <div className={clsx(styles.left)}>
        <span
          id="task-title-collapsed"
          className={clsx(
            "task-title",
            "text-truncate",
            "text-size-larger",
            styles.task
          )}
          title={evalSpec?.task}
        >
          {evalSpec?.task}
        </span>
        {modelText ? (
          <span
            id="task-model-collapsed"
            className={clsx(
              "task-model",
              "text-truncate",
              "text-size-small",
              styles.model
            )}
            title={modelText}
          >
            ({modelText})
          </span>
        ) : null}
      </div>
      <div className={clsx(styles.right, "text-size-smaller")}>
        {showMetrics && totalMetrics > 0 ? (
          totalMetrics <= kInlineMetricLimit ? (
            <InlineMetrics scorers={expandedScorers} />
          ) : (
            <MetricsLink scorers={expandedScorers} />
          )
        ) : (
          <StatusBadge status={status} sampleCount={sampleCount} />
        )}
      </div>
    </div>
  );
};

const formatModelText = (evalSpec?: EvalSpec): string | undefined => {
  if (!evalSpec) return undefined;
  const roles = evalSpec.model_roles;
  if (roles && Object.keys(roles).length > 0) {
    return Object.entries(roles)
      .map(([role, data]) => `${role}: ${data.model}`)
      .join(", ");
  }
  if (evalSpec.model && evalSpec.model !== kModelNone) {
    return evalSpec.model;
  }
  return undefined;
};

interface InlineMetricsProps {
  scorers: ReturnType<typeof expandGroupedMetrics>;
}

const InlineMetrics: FC<InlineMetricsProps> = ({ scorers }) => {
  const items: { key: string; label: string; value: string }[] = [];
  scorers.forEach((scorer, scorerIdx) => {
    scorer.metrics.forEach((metric, metricIdx) => {
      items.push({
        key: `${scorerIdx}-${metricIdx}`,
        label: metricDisplayName(metric),
        value:
          metric.value !== undefined && metric.value !== null
            ? formatPrettyDecimal(metric.value)
            : "n/a",
      });
    });
  });

  return (
    <div className={styles.inlineMetrics}>
      {items.map((item) => (
        <span key={item.key} className={styles.inlineMetric}>
          <span className={clsx("text-style-label", styles.inlineMetricLabel)}>
            {item.label}
          </span>
          <span className={styles.inlineMetricValue}>{item.value}</span>
        </span>
      ))}
    </div>
  );
};

interface StatusBadgeProps {
  status?: EvalLogStatus;
  sampleCount?: number;
}

const StatusBadge: FC<StatusBadgeProps> = ({ status, sampleCount }) => {
  const display = statusDisplay(status);
  if (!display) return null;
  const count = sampleCount ?? 0;
  return (
    <div className={styles.statusBadge}>
      <i className={clsx(display.icon, styles.statusIcon)} />
      <span className="text-style-label">{display.label}</span>
      {count > 0 ? (
        <span className={styles.statusCount}>
          ({count} {count === 1 ? "sample" : "samples"})
        </span>
      ) : null}
    </div>
  );
};

const statusDisplay = (
  status?: EvalLogStatus
): { icon: string; label: string } | undefined => {
  switch (status) {
    case "started":
      return { icon: ApplicationIcons.running, label: "Running" };
    case "cancelled":
      return { icon: ApplicationIcons.logging.info, label: "Cancelled" };
    case "error":
      return { icon: ApplicationIcons.logging.error, label: "Task Failed" };
    default:
      return undefined;
  }
};

interface MetricsLinkProps {
  scorers: ReturnType<typeof expandGroupedMetrics>;
}

const MetricsLink: FC<MetricsLinkProps> = ({ scorers }) => {
  const grouped = groupScorers(scorers);
  const showReducer = scorers.findIndex((s) => !!s.reducer) !== -1;

  // The modal is portaled to <body> so it escapes the title-view collapsing
  // wrapper (which sets opacity: 0 on whichever slot is hidden). Without the
  // portal, the modal would inherit that opacity and become invisible while
  // still capturing pointer events.
  const [showing, setShowing] = useState(false);

  return (
    <>
      <LinkButton text="View metrics…" onClick={() => setShowing(true)} />
      {createPortal(
        <Modal
          id="collapsed-title-bar-metrics"
          showing={showing}
          setShowing={setShowing}
          title="Scoring Detail"
          overflow="hidden"
          padded={false}
          className={styles.scoringDetailModal}
        >
          <ScoreAgGrid scoreGroups={grouped} showReducer={showReducer} />
        </Modal>,
        document.body
      )}
    </>
  );
};
