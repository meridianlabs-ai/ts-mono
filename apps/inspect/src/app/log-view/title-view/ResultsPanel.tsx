import clsx from "clsx";
import { FC } from "react";

import { Modal } from "@tsmono/react/components";
import { useProperty } from "@tsmono/react/hooks";
import { formatPrettyDecimal } from "@tsmono/util";

import { RunningMetric } from "../../../client/api/types";
import { LinkButton } from "../../../components/LinkButton";
import { leadWith } from "../../../scoring/headline";
import {
  expandGroupedMetrics,
  metricDisplayName,
} from "../../../scoring/metrics";
import {
  groupScorers,
  leadWithMetricColumn,
} from "../../../scoring/scores";
import { MetricSummary, ScoreSummary } from "../../../scoring/types";

import styles from "./ResultsPanel.module.css";
import { ScoreGrid } from "./ScoreGrid";
import { UnscoredSamples } from "./UnscoredSamplesView";

const kMaxPrimaryScoreRows = 3;
const kMaxPrimaryMetricColumns = 5;

export const displayScorersFromRunningMetrics = (metrics?: RunningMetric[]) => {
  if (!metrics) {
    return [];
  }

  // include the originating scorer: two dict-valued scorers can emit the same
  // score name, and grouping on the name alone merges them into one row.
  // JSON-encoded so a separator inside any component can't forge a collision
  const getKey = (metric: RunningMetric) =>
    JSON.stringify([metric.scorer_name ?? null, metric.scorer, metric.reducer]);

  const scorers: Record<string, ScoreSummary> = {};
  metrics.forEach((metric) => {
    if (metric.value !== undefined && metric.value !== null) {
      const key = getKey(metric);
      if (scorers[key]) {
        scorers[key].metrics.push({
          name: metric.name,
          value: metric.value,
          params: metric.params,
          headline: metric.headline,
        });
      } else {
        scorers[key] = {
          scorer: metric.scorer,
          scorerName: metric.scorer_name ?? undefined,
          reducer: metric.reducer,
          metrics: [
            {
              name: metric.name,
              value: metric.value,
              params: metric.params,
              headline: metric.headline,
            },
          ],
        };
      }
    }
  });

  return expandGroupedMetrics(Object.values(scorers));
};

interface ResultsPanelProps {
  scorers?: ScoreSummary[];
  /** Whether the task declared its headline. Undeclared, the mark is just the
   * first metric of the first score, and must not outrank the existing
   * preference for a group that fits. */
  headlineDeclared?: boolean;
}

export const ResultsPanel: FC<ResultsPanelProps> = ({
  scorers,
  headlineDeclared,
}) => {
  const [showing, setShowing] = useProperty(
    "results-panel-metrics",
    "modal-showing",
    {
      defaultValue: false,
    }
  );

  if (!scorers || scorers.length === 0) {
    return undefined;
  }

  const expandedScorers = expandGroupedMetrics(scorers);

  // Get the display scorers
  const onlyScorer =
    expandedScorers.length === 1 ? expandedScorers[0] : undefined;
  if (onlyScorer) {
    const showReducer = !!onlyScorer.reducer;
    // lead with the headline so the column cap below can't drop it
    const metrics = leadWith(
      onlyScorer.metrics,
      onlyScorer.metrics.findIndex((metric) => metric.headline)
    );
    const primaryMetrics = metrics.slice(0, kMaxPrimaryMetricColumns);
    const showMore = primaryMetrics.length < metrics.length;
    const unscoredSamples = onlyScorer.unscoredSamples || 0;
    const scoredSamples = onlyScorer.scoredSamples || 0;
    return (
      <div className={styles.metricsSummary}>
        <div className={styles.simpleMetricsRows}>
          {primaryMetrics.map((metric, i) => {
            return (
              <VerticalMetric
                key={`simple-metric-${i}`}
                reducer={onlyScorer.reducer}
                metric={metric}
                isFirst={i === 0}
                showReducer={showReducer}
                unscoredSamples={unscoredSamples}
                scoredSamples={scoredSamples}
              />
            );
          })}
        </div>
        {showMore ? (
          <ScoringDetail
            grouped={groupScorers(expandedScorers)}
            showReducer={showReducer}
            showing={showing}
            setShowing={setShowing}
          />
        ) : undefined}
      </div>
    );
  } else {
    const showReducer =
      expandedScorers.findIndex((score) => !!score.reducer) !== -1;
    const grouped = groupScorers(expandedScorers);

    // If grouping produced an empty array, no results to show
    if (grouped.length < 1) {
      return undefined;
    }

    // Lead with the group holding the headline metric, and within it the
    // headline's own score, so truncation below can't drop the headline
    const holdsHeadline = (group: ScoreSummary[]) =>
      group.findIndex((score) => score.metrics.some((m) => m.headline));
    const headlineGroup = grouped.findIndex(
      (group) => holdsHeadline(group) !== -1
    );
    let primaryResults =
      headlineGroup !== -1
        ? leadWith(
            grouped[headlineGroup] as ScoreSummary[],
            holdsHeadline(grouped[headlineGroup] as ScoreSummary[])
          )
        : grouped[0];

    // If there are no primary results, nothing to show here
    if (!primaryResults) {
      return undefined;
    }

    let showMore = grouped.length > 1;
    if (primaryResults.length > kMaxPrimaryScoreRows) {
      // a declared headline's group stays selected even when oversized (it
      // truncates below); otherwise prefer a group that fits
      const shorterResults =
        headlineDeclared && headlineGroup !== -1
          ? undefined
          : grouped.find((g) => {
              return g.length <= kMaxPrimaryScoreRows;
            });
      if (shorterResults) {
        primaryResults = shorterResults;
      }

      // If the primary metrics are still too long, truncate them and
      // show the rest in the modal
      if (primaryResults.length > kMaxPrimaryScoreRows) {
        primaryResults = primaryResults.slice(0, kMaxPrimaryScoreRows);
        showMore = true;
      }
    }

    if (
      primaryResults.some(
        (score) => score.metrics.length > kMaxPrimaryMetricColumns
      )
    ) {
      // scores in a group share an ordered metric signature, so fronting the
      // same column index in every row keeps the grid's columns aligned while
      // ensuring the cap can't drop the headline
      const headlineColumn = primaryResults.reduce(
        (found, score) =>
          found !== -1
            ? found
            : score.metrics.findIndex((metric) => metric.headline),
        -1
      );
      primaryResults = primaryResults.map((score) => ({
        ...score,
        metrics: leadWithMetricColumn(score.metrics, headlineColumn).slice(
          0,
          kMaxPrimaryMetricColumns
        ),
      }));
      showMore = true;
    }

    return (
      <div className={clsx(styles.metricsSummary)}>
        <ScoreGrid
          scoreGroups={[primaryResults]}
          showReducer={showReducer}
          compact
        />
        {showMore ? (
          <ScoringDetail
            grouped={grouped}
            showReducer={showReducer}
            showing={showing}
            setShowing={setShowing}
          />
        ) : undefined}
      </div>
    );
  }
};

interface ScoringDetailProps {
  grouped: ScoreSummary[][];
  showReducer: boolean;
  showing: boolean;
  setShowing: (showing: boolean) => void;
}

const ScoringDetail: FC<ScoringDetailProps> = ({
  grouped,
  showReducer,
  showing,
  setShowing,
}) => (
  <>
    <Modal
      id="results-metrics"
      show={showing}
      onHide={() => setShowing(false)}
      title="Scoring Detail"
      width="min(1000px, 90vw)"
      overflow="hidden"
      padded={false}
      className={styles.scoringDetailModal}
      footer={
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowing(false)}
        >
          Close
        </button>
      }
    >
      <ScoreGrid scoreGroups={grouped} showReducer={showReducer} />
    </Modal>
    <LinkButton
      className={styles.moreButton}
      text="All scoring..."
      onClick={() => setShowing(true)}
    />
  </>
);

interface VerticalMetricProps {
  metric: MetricSummary;
  reducer?: string;
  isFirst: boolean;
  showReducer: boolean;
  unscoredSamples: number;
  scoredSamples: number;
}

/** Renders a Vertical Metric
 */
const VerticalMetric: FC<VerticalMetricProps> = ({
  metric,
  reducer,
  isFirst,
  showReducer,
  scoredSamples,
  unscoredSamples,
}) => {
  return (
    <div style={{ paddingLeft: isFirst ? "0" : "1em" }}>
      <div
        className={clsx(
          "vertical-metric-label",
          "text-style-label",
          "text-style-secondary",
          styles.verticalMetricName
        )}
      >
        {metricDisplayName(metric)}
        <UnscoredSamples
          scoredSamples={scoredSamples}
          unscoredSamples={unscoredSamples}
        />
      </div>
      {showReducer ? (
        <div
          className={clsx(
            "text-style-label",
            "text-style-secondary",
            styles.verticalMetricReducer
          )}
        >
          {reducer || "default"}
        </div>
      ) : undefined}

      <div
        className={clsx(
          "vertical-metric-value",
          "text-size-largest",
          styles.verticalMetricValue
        )}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
        {metric.value !== undefined && metric.value !== null
          ? formatPrettyDecimal(metric.value)
          : "n/a"}
      </div>
    </div>
  );
};
