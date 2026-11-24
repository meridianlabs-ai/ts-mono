import clsx from "clsx";
import { FC, ReactNode } from "react";

import type {
  SentinelEvalStats,
  SentinelEvent,
  SentinelStats,
} from "@tsmono/inspect-common/types";
import { formatNumber } from "@tsmono/util";

import { sentinelStageLabels } from "../transcript/transform/toolSentinels";

import styles from "./SentinelStatsPanel.module.css";

interface SentinelStatsPanelProps {
  /** Each sentinel's stats, by name: a sample's, or an eval's added up. */
  stats?: Record<string, SentinelStats | SentinelEvalStats> | null;
  className?: string;
}

/** What each sentinel did over a sample or an eval: its steps, decisions and questions for a person, and for a sentinel outside the eval, the calls Inspect sent through it. */
export const SentinelStatsPanel: FC<SentinelStatsPanelProps> = ({
  stats,
  className,
}) => {
  const entries = Object.entries(stats ?? {});
  if (entries.length === 0) return null;
  return (
    <div className={clsx(styles.panel, className)}>
      <div className={clsx("text-style-label", styles.title)}>Sentinels</div>
      {entries.map(([name, entry]) => (
        <SentinelStatsEntry key={name} name={name} stats={entry} />
      ))}
    </div>
  );
};

const isEvalStats = (
  stats: SentinelStats | SentinelEvalStats
): stats is SentinelEvalStats => "samples" in stats;

const SentinelStatsEntry: FC<{
  name: string;
  stats: SentinelStats | SentinelEvalStats;
}> = ({ name, stats }) => {
  const steps = stats.steps ? orderedStages(stats.steps) : undefined;
  const actions = stats.actions ? orderedActions(stats.actions) : [];
  const reviews = stats.human_reviews;
  return (
    <section className={styles.entry} aria-label={name}>
      <div className={styles.head}>
        <span className={styles.name}>{name}</span>
        {isEvalStats(stats) ? (
          <span className={styles.note}>
            {plural(stats.samples, "sample")} counted
            {stats.incomplete_samples > 0
              ? ` · ${formatNumber(stats.incomplete_samples)} left out as incomplete`
              : null}
          </span>
        ) : null}
        {!isEvalStats(stats) && !stats.complete ? (
          <span className={styles.incomplete}>
            {stats.incomplete_reason
              ? `Incomplete: ${stats.incomplete_reason}`
              : "Incomplete"}
          </span>
        ) : null}
      </div>
      {steps ? (
        <table className={styles.steps}>
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">Reached</th>
              <th scope="col">Judged</th>
              <th scope="col">Not judged</th>
            </tr>
          </thead>
          <tbody>
            {steps.map(([stage, counts]) => (
              <tr key={stage}>
                <th scope="row">{stageLabel(stage)}</th>
                <td>{formatNumber(counts.total)}</td>
                <td>{formatNumber(counts.judged)}</td>
                <td>{unjudgedText(counts.unjudged)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={styles.note}>No step counts.</div>
      )}
      {actions.length > 0 ? (
        <Line label="Decisions">
          {actions
            .map(([action, count]) => `${action} ${formatNumber(count)}`)
            .join(" · ")}
        </Line>
      ) : null}
      {reviews && reviews.total > 0 ? (
        <Line label="Asked a person">
          {[
            plural(reviews.total, "question"),
            `${formatNumber(reviews.answered)} answered`,
            `${formatNumber(reviews.timed_out)} timed out`,
            `${formatNumber(reviews.cancelled)} cancelled`,
          ].join(" · ")}
        </Line>
      ) : null}
      {isEvalStats(stats) ? (
        stats.model_calls > 0 ? (
          <Line label="Remote">
            {plural(stats.model_calls, "model call")}
            {unrecordedText(stats.unrecorded_calls)}
          </Line>
        ) : null
      ) : stats.remote ? (
        <Line label="Remote">
          <span className={styles.mono}>{stats.remote.proxy_url}</span>
          {` · ${plural(stats.remote.model_calls, "model call")}`}
          {unrecordedText(stats.remote.unrecorded_calls)}
          {stats.remote.results_withheld === true
            ? " · results withheld from the eval"
            : null}
          {stats.remote.results_withheld === false
            ? " · results sent to the eval"
            : null}
          {stats.remote.results_withheld == null
            ? " · results withheld: not reported"
            : null}
        </Line>
      ) : null}
    </section>
  );
};

const Line: FC<{ label: string; children: ReactNode }> = ({
  label,
  children,
}) => (
  <div className={styles.line}>
    <span className={styles.label}>{label}</span>
    <span>{children}</span>
  </div>
);

const kStageOrder: readonly string[] = [
  "model_input",
  "model_output",
  "tool_call",
  "tool_result",
];

const kActionOrder: readonly string[] = [
  "proceed",
  "modify",
  "reject",
  "terminate",
  "escalate",
];

const ordered = <T,>(
  record: Record<string, T>,
  order: readonly string[]
): [string, T][] => {
  const entries = Object.entries(record);
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return entries.sort(([a], [b]) => rank(a) - rank(b));
};

const orderedStages = (steps: NonNullable<SentinelStats["steps"]>) =>
  ordered(steps, kStageOrder);

const orderedActions = (actions: NonNullable<SentinelStats["actions"]>) =>
  ordered(actions, kActionOrder);

const isStage = (stage: string): stage is SentinelEvent["stage"] =>
  kStageOrder.includes(stage);

const stageLabel = (stage: string): string =>
  isStage(stage) ? sentinelStageLabels[stage] : stage;

const unjudgedText = (unjudged: Record<string, number>): string => {
  const reasons = Object.entries(unjudged).filter(([, count]) => count > 0);
  if (reasons.length === 0) return "0";
  const total = reasons.reduce((sum, [, count]) => sum + count, 0);
  const detail = reasons
    .map(([reason, count]) => `${reason} ${formatNumber(count)}`)
    .join(", ");
  return `${formatNumber(total)} (${detail})`;
};

const unrecordedText = (count: number): string | null =>
  count > 0
    ? ` · ${formatNumber(count)} unrecorded by the remote sentinel`
    : null;

const plural = (count: number, noun: string): string =>
  `${formatNumber(count)} ${noun}${count === 1 ? "" : "s"}`;
