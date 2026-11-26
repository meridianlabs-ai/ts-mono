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

/** Each sentinel's stats, by name: a sample's, or an eval's added up. */
type SentinelStatsPanelProps = { className?: string } & (
  | { kind: "sample"; stats?: Record<string, SentinelStats> | null }
  | { kind: "eval"; stats?: Record<string, SentinelEvalStats> | null }
);

type Entry =
  | { kind: "sample"; name: string; stats: SentinelStats }
  | { kind: "eval"; name: string; stats: SentinelEvalStats };

const sampleEntry = ([name, stats]: [string, SentinelStats]): Entry => ({
  kind: "sample",
  name,
  stats,
});

const evalEntry = ([name, stats]: [string, SentinelEvalStats]): Entry => ({
  kind: "eval",
  name,
  stats,
});

/** What each sentinel did over a sample or an eval: its steps, decisions and questions for a person, and for a sentinel outside the eval, the calls Inspect sent through it. */
export const SentinelStatsPanel: FC<SentinelStatsPanelProps> = (props) => {
  const entries =
    props.kind === "eval"
      ? Object.entries(props.stats ?? {}).map(evalEntry)
      : Object.entries(props.stats ?? {}).map(sampleEntry);
  if (entries.length === 0) return null;
  return (
    <div className={clsx(styles.panel, props.className)}>
      <div className={clsx("text-style-label", styles.title)}>Sentinels</div>
      {entries.map((entry) => (
        <SentinelStatsEntry key={entry.name} entry={entry} />
      ))}
    </div>
  );
};

const SentinelStatsEntry: FC<{ entry: Entry }> = ({ entry }) => {
  const { name, stats } = entry;
  const steps = stats.steps ? orderedStages(stats.steps) : undefined;
  const actions = stats.actions ? orderedActions(stats.actions) : [];
  const reviews = stats.human_reviews;
  return (
    <section className={styles.entry} aria-label={name}>
      <div className={styles.head}>
        <span className={styles.name}>{name}</span>
        {entry.kind === "eval" ? (
          <span className={styles.note}>
            {plural(entry.stats.samples, "sample")} counted
            {entry.stats.incomplete_samples > 0
              ? ` · ${formatNumber(entry.stats.incomplete_samples)} left out as incomplete`
              : null}
          </span>
        ) : null}
        {entry.kind === "sample" && !entry.stats.complete ? (
          <span className={styles.incomplete}>
            {entry.stats.incomplete_reason
              ? `Incomplete: ${entry.stats.incomplete_reason}`
              : "Incomplete"}
          </span>
        ) : null}
      </div>
      {steps && steps.length > 0 ? (
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
        <div className={styles.note}>
          {steps ? "No steps." : "No step counts."}
        </div>
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
      {entry.kind === "eval" ? (
        entry.stats.model_calls > 0 ? (
          <Line label="Remote">
            {plural(entry.stats.model_calls, "model call")}
            {unrecordedText(entry.stats.unrecorded_calls)}
          </Line>
        ) : null
      ) : entry.stats.remote ? (
        <Line label="Remote">
          <span className={styles.mono}>{entry.stats.remote.proxy_url}</span>
          {` · ${plural(entry.stats.remote.model_calls, "model call")}`}
          {unrecordedText(entry.stats.remote.unrecorded_calls)}
          {entry.stats.remote.results_withheld === true
            ? " · results withheld from the eval"
            : null}
          {entry.stats.remote.results_withheld === false
            ? " · results sent to the eval"
            : null}
          {entry.stats.remote.results_withheld == null
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
