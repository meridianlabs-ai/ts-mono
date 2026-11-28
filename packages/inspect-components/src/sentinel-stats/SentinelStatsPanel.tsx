import clsx from "clsx";
import { FC, Fragment, MouseEvent, ReactNode, useState } from "react";

import type {
  SentinelEvalStats,
  SentinelEvent,
  SentinelStats,
} from "@tsmono/inspect-common/types";
import { SegmentedControl } from "@tsmono/react/components";
import { useProperty } from "@tsmono/react/hooks";
import { Icon } from "@tsmono/react/icons";
import { formatNumber } from "@tsmono/util";

import type { MetaItem } from "../usage/UsagePanel";

import {
  notableSamples,
  type NotableSample,
  type SampleStatus,
  type SentinelSampleSummary,
} from "./notableSamples";
import type { NotableStatus, NotableStep } from "./notableSteps";
import { configuredSentinel, type ConfiguredSentinel } from "./sentinelConfig";
import styles from "./SentinelStatsPanel.module.css";

type StepCounts = NonNullable<SentinelStats["steps"]>[string];

/** One sentinel's stats, whichever kind of panel shows them. */
interface Entry {
  name: string;
  steps?: Record<string, StepCounts> | null;
  actions?: Record<string, number> | null;
  reviews?: SentinelStats["human_reviews"];
  /** Set for a sentinel outside the eval. */
  remote?: {
    proxyUrl?: string;
    version?: number;
    release?: string;
    modelCalls: number;
    unrecordedCalls: number;
    resultsWithheld?: boolean | null;
  };
  /** A sample's stats that don't cover the whole sample, and why. */
  incomplete?: string;
  /** An eval's: the samples added up, and those left out as incomplete. */
  samples?: { counted: number; leftOut: number };
}

const sampleEntry = (name: string, stats: SentinelStats): Entry => ({
  name,
  steps: stats.steps,
  actions: stats.actions,
  reviews: stats.human_reviews,
  remote: stats.remote
    ? {
        proxyUrl: stats.remote.proxy_url,
        version: stats.remote.version,
        release: stats.remote.release,
        modelCalls: stats.remote.model_calls,
        unrecordedCalls: stats.remote.unrecorded_calls,
        resultsWithheld: stats.remote.results_withheld,
      }
    : undefined,
  incomplete: stats.complete
    ? undefined
    : (stats.incomplete_reason ?? "The counts don't cover the whole sample."),
});

const evalEntry = (name: string, stats: SentinelEvalStats): Entry => ({
  name,
  steps: stats.steps,
  actions: stats.actions,
  reviews: stats.human_reviews,
  // Only a remote sentinel's calls go through a proxy.
  remote:
    stats.model_calls > 0
      ? {
          modelCalls: stats.model_calls,
          unrecordedCalls: stats.unrecorded_calls,
        }
      : undefined,
  samples: { counted: stats.samples, leftOut: stats.incomplete_samples },
});

type SentinelStatsPanelProps = {
  className?: string;
  /** `EvalConfig.sentinel`, which draws the in-eval sentinel's stack. */
  config?: unknown;
  /** Keys the selected sentinel, so it survives remounts. */
  stateKey?: string;
} & (
  | {
      kind: "sample";
      stats?: Record<string, SentinelStats> | null;
      /** The sample's steps where a sentinel stepped in or didn't check. */
      steps?: NotableStep[];
      /** Shows a step in the transcript. */
      onOpenEvent?: (eventId: string, event: MouseEvent) => void;
    }
  | {
      kind: "eval";
      stats?: Record<string, SentinelEvalStats> | null;
      meta?: MetaItem[];
      /** The eval's sample summaries, whose stats name the samples worth opening. */
      samples?: readonly SentinelSampleSummary[];
      /** A link that opens a sample. */
      renderOpenSample?: (sample: NotableSample) => ReactNode;
    }
);

/** What each sentinel did over a sample or an eval: what it checked and decided, how it was set up, and where to look. */
export const SentinelStatsPanel: FC<SentinelStatsPanelProps> = (props) => {
  const entries =
    props.kind === "eval"
      ? Object.entries(props.stats ?? {}).map(([n, s]) => evalEntry(n, s))
      : Object.entries(props.stats ?? {}).map(([n, s]) => sampleEntry(n, s));
  const [picked, setPicked] = useProperty<string | null>(
    "sentinel-stats",
    props.stateKey ?? props.kind,
    { defaultValue: null }
  );
  const entry = entries.find((e) => e.name === picked) ?? entries[0];
  if (!entry) return null;
  const configured = configuredFor(entry, entries, props.config);
  const meta = props.kind === "eval" ? (props.meta ?? []) : [];
  return (
    <div
      className={clsx(
        styles.panel,
        props.kind === "eval" && styles.eval,
        props.className
      )}
    >
      <div className={styles.head}>
        <div className={styles.headLeft}>
          <div className={clsx("text-style-label", styles.title)}>
            Sentinels
          </div>
          {entries.length > 1 ? (
            <SegmentedControl
              segments={entries.map((e) => ({ id: e.name, label: e.name }))}
              selectedId={entry.name}
              onSegmentChange={(id) => setPicked(id)}
            />
          ) : null}
        </div>
        {meta.length > 0 ? <Meta items={meta} /> : null}
      </div>
      <section className={styles.entry} aria-label={entry.name}>
        <div className={styles.entryHead}>
          <div className={styles.entryName}>
            <span className={styles.name}>{entry.name}</span>
            <span
              className={clsx(
                styles.badge,
                entry.remote ? styles.remoteBadge : styles.localBadge
              )}
            >
              {entry.remote ? "remote" : "in eval"}
            </span>
          </div>
          <Meta
            items={[
              ...((entry.remote?.version ?? configured?.version) != null
                ? [
                    {
                      label: "Version",
                      value: String(
                        entry.remote?.version ?? configured?.version
                      ),
                    },
                  ]
                : []),
              ...(entry.remote?.release
                ? [{ label: "Release", value: entry.remote.release }]
                : []),
            ]}
          />
        </div>
        {entry.incomplete ? (
          <div className={styles.warning} role="alert">
            <Icon name="warning" />
            <span>Incomplete: {entry.incomplete}</span>
          </div>
        ) : null}
        <Part label="Activity">
          <Activity entry={entry} kind={props.kind} />
        </Part>
        <Part label="Configuration">
          <Configuration entry={entry} configured={configured} />
        </Part>
        {props.kind === "sample" ? (
          <StepsPart
            steps={(props.steps ?? []).filter((step) =>
              entry.remote
                ? step.proxyUrl === entry.remote.proxyUrl
                : !step.proxyUrl
            )}
            onOpenEvent={props.onOpenEvent}
          />
        ) : (
          <SamplesPart
            key={entry.name}
            samples={notableSamples(props.samples ?? [], entry.name)}
            renderOpenSample={props.renderOpenSample}
          />
        )}
      </section>
    </div>
  );
};

/** The config describes the one sentinel inside the eval; a remote sentinel's checks aren't in the log. */
const configuredFor = (
  entry: Entry,
  entries: Entry[],
  config: unknown
): ConfiguredSentinel | undefined => {
  if (entry.remote) return undefined;
  const configured = configuredSentinel(config);
  if (!configured) return undefined;
  const local = entries.filter((e) => !e.remote);
  return configured.name === entry.name || local.length === 1
    ? configured
    : undefined;
};

const Meta: FC<{ items: MetaItem[] }> = ({ items }) =>
  items.length > 0 ? (
    <div className={styles.meta}>
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 ? <span className={styles.metaSep} /> : null}
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>{item.label}</span>
            <span className={styles.metaValue}>{item.value}</span>
          </span>
        </Fragment>
      ))}
    </div>
  ) : null;

const Part: FC<{ label: string; children: ReactNode }> = ({
  label,
  children,
}) => (
  <div className={styles.part}>
    <div className={styles.partLabel}>{label}</div>
    <div className={styles.partBody}>{children}</div>
  </div>
);

const Figure: FC<{
  label: string;
  wide?: boolean;
  children: ReactNode;
}> = ({ label, wide, children }) => (
  <div className={clsx(styles.figure, wide && styles.wide)}>
    <span className={styles.figureLabel}>{label}</span>
    {children}
  </div>
);

const Big: FC<{ value: string; unit?: string }> = ({ value, unit }) => (
  <span className={styles.big}>
    {value}
    {unit ? <small>{unit}</small> : null}
  </span>
);

const Activity: FC<{ entry: Entry; kind: "sample" | "eval" }> = ({
  entry,
  kind,
}) => {
  const stages = entry.steps ? orderedStages(entry.steps) : undefined;
  const reached = sum(stages?.map(([, c]) => c.total));
  const checked = sum(stages?.map(([, c]) => c.judged));
  const actions = entry.actions ? orderedActions(entry.actions) : [];
  const steppedIn = sum(
    actions.filter(([a]) => a !== "proceed").map(([, n]) => n)
  );
  const reviews = entry.reviews;
  const remote = entry.remote;
  return (
    <div className={styles.figures}>
      {stages ? (
        <Figure label="Checked">
          <Big
            value={`${formatNumber(checked)} of ${formatNumber(reached)}`}
            unit={percent(checked, reached)}
          />
          <span className={styles.sub}>steps</span>
          {entry.samples ? (
            <span className={styles.sub}>
              {plural(entry.samples.counted, "sample")}
              {entry.samples.leftOut > 0
                ? ` · ${formatNumber(entry.samples.leftOut)} left out as incomplete`
                : null}
            </span>
          ) : null}
        </Figure>
      ) : null}
      <Figure label="What it decided" wide>
        {!stages ? (
          <span className={styles.sub}>
            {remote
              ? "It reported model calls only, not its individual decisions."
              : "It recorded no step counts."}
          </span>
        ) : actions.length > 0 ? (
          <Decisions
            actions={actions}
            steppedIn={steppedIn}
            checked={checked}
          />
        ) : (
          <span className={styles.sub}>No decisions.</span>
        )}
      </Figure>
      <Figure label="Human review">
        {reviews && reviews.total > 0 ? (
          <>
            <Big
              value={formatNumber(reviews.total)}
              unit={reviews.total === 1 ? "question" : "questions"}
            />
            <span className={styles.sub}>
              {[
                [reviews.answered, "answered"] as const,
                [reviews.timed_out, "timed out"] as const,
                [reviews.cancelled, "cancelled"] as const,
              ]
                .filter(([n]) => n > 0)
                .map(([n, word]) => `${formatNumber(n)} ${word}`)
                .join(" · ")}
            </span>
          </>
        ) : (
          <span className={styles.sub}>None</span>
        )}
      </Figure>
      {remote && remote.modelCalls > 0 ? (
        <Figure label="Recorded">
          <Big
            value={`${formatNumber(remote.modelCalls - remote.unrecordedCalls)} of ${formatNumber(remote.modelCalls)}`}
            unit={percent(
              remote.modelCalls - remote.unrecordedCalls,
              remote.modelCalls
            )}
          />
          <span className={styles.sub}>model calls sent through it</span>
        </Figure>
      ) : null}
      {kind === "sample" && stages && stages.length > 1 ? (
        <Figure label="By stage" wide>
          <table className={styles.stages}>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Reached</th>
                <th scope="col">Checked</th>
                <th scope="col">Not checked</th>
              </tr>
            </thead>
            <tbody>
              {stages.map(([stage, counts]) => (
                <tr key={stage}>
                  <th scope="row" className={styles.mono}>
                    {stageName(stage)}
                  </th>
                  <td>{formatNumber(counts.total)}</td>
                  <td>{formatNumber(counts.judged)}</td>
                  <td>{notCheckedText(counts.unjudged)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Figure>
      ) : null}
    </div>
  );
};

const kActionWords: Record<string, string> = {
  proceed: "proceeded",
  modify: "modified",
  reject: "rejected",
  terminate: "terminated",
  escalate: "escalated",
};

const actionTone = (action: string): string | undefined => {
  switch (action) {
    case "reject":
    case "terminate":
      return styles.toneReject;
    case "modify":
    case "escalate":
      return styles.toneModify;
    case "proceed":
      return styles.toneProceed;
    default:
      return undefined;
  }
};

const Decisions: FC<{
  actions: [string, number][];
  steppedIn: number;
  checked: number;
}> = ({ actions, steppedIn, checked }) => {
  const shown = actions.filter(([, n]) => n > 0);
  const total = sum(shown.map(([, n]) => n));
  return (
    <>
      <span>
        Stepped in on <b>{formatNumber(steppedIn)}</b> of{" "}
        {formatNumber(checked)}
        {checked > 0 ? (
          <span className={styles.muted}> · {percent(steppedIn, checked)}</span>
        ) : null}
      </span>
      {total > 0 ? (
        <div className={styles.bar} aria-hidden="true">
          {shown.map(([action, n]) => (
            <span
              key={action}
              className={actionTone(action)}
              style={{ width: `${(n / total) * 100}%` }}
            />
          ))}
        </div>
      ) : null}
      <div className={styles.legend}>
        {shown.map(([action, n]) => (
          <span key={action}>
            <span className={clsx(styles.swatch, actionTone(action))} />
            <b>{formatNumber(n)}</b> {kActionWords[action] ?? action}
          </span>
        ))}
      </div>
    </>
  );
};

const Configuration: FC<{
  entry: Entry;
  configured?: ConfiguredSentinel;
}> = ({ entry, configured }) => {
  const stages = entry.steps ? orderedStages(entry.steps) : [];
  return (
    <div className={styles.figures}>
      <Figure label="Checks at">
        {stages.length > 0 ? (
          <span className={styles.mono}>
            {stages.map(([stage]) => stageName(stage)).join(", ")}
          </span>
        ) : (
          <span className={styles.sub}>not reported</span>
        )}
      </Figure>
      {configured ? (
        <Figure label="Stack" wide>
          <div className={styles.stack}>
            {configured.rows.map((row, i) => (
              <div key={i}>
                {row.guides ? (
                  <span className={styles.guides}>{row.guides}</span>
                ) : null}
                <b>{row.name}</b>{" "}
                <span className={styles.factory}>{row.factory}</span>
              </div>
            ))}
          </div>
        </Figure>
      ) : entry.remote ? (
        <Figure label="Stack" wide>
          <span className={styles.sub}>
            Set up outside the eval, so its checks are not in the log.
            {entry.remote.resultsWithheld
              ? " It sent decisions only; check reports were withheld."
              : null}
          </span>
          {entry.remote.proxyUrl ? (
            <span className={styles.proxy}>
              <span className={styles.metaLabel}>Proxy</span>{" "}
              <span className={styles.mono}>{entry.remote.proxyUrl}</span>
            </span>
          ) : null}
        </Figure>
      ) : null}
    </div>
  );
};

const kStatusTone: Record<NotableStatus, string | undefined> = {
  rejected: styles.pillReject,
  terminated: styles.pillReject,
  modified: styles.pillModify,
  escalated: styles.pillModify,
  "not checked": styles.pillNeutral,
};

const StepsPart: FC<{
  steps: NotableStep[];
  onOpenEvent?: (eventId: string, event: MouseEvent) => void;
}> = ({ steps, onOpenEvent }) =>
  steps.length > 0 ? (
    <Part label="Steps">
      <div className={styles.list}>
        {steps.map((step, i) => (
          <div key={step.eventId ?? i} className={styles.listRow}>
            <span className={clsx(styles.pill, kStatusTone[step.status])}>
              {step.status}
            </span>
            <span className={styles.listSubject}>
              <span className={styles.mono}>{step.subject}</span>
              <span className={styles.muted}>
                {" · "}
                {stageName(step.stage)}
              </span>
            </span>
            <span className={styles.listReason}>{step.reason}</span>
            {step.eventId && onOpenEvent ? (
              <button
                type="button"
                className={styles.link}
                onClick={(event) => {
                  if (step.eventId) onOpenEvent(step.eventId, event);
                }}
              >
                show step →
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
    </Part>
  ) : null;

const kSampleStatusTone: Record<SampleStatus, string | undefined> = {
  terminated: styles.pillReject,
  "not checked": styles.pillNeutral,
  "left out": styles.pillWarning,
};

/** Rows shown before "show all", so a large eval's list stays a summary. */
const kSamplesShown = 10;

const SamplesPart: FC<{
  samples: NotableSample[];
  renderOpenSample?: (sample: NotableSample) => ReactNode;
}> = ({ samples, renderOpenSample }) => {
  const [all, setAll] = useState(false);
  if (samples.length === 0) return null;
  const shown = all ? samples : samples.slice(0, kSamplesShown);
  return (
    <Part label="Samples">
      <div className={styles.list}>
        {shown.map((sample) => (
          <div
            key={`${sample.id}-${sample.epoch}`}
            className={clsx(styles.listRow, styles.sampleRow)}
          >
            <span
              className={clsx(styles.pill, kSampleStatusTone[sample.status])}
            >
              {sample.status}
            </span>
            <span className={styles.listSubject}>
              <span className={styles.mono}>{sample.id}</span>
              <span className={styles.muted}> · epoch {sample.epoch}</span>
            </span>
            <span className={styles.listReason}>{sample.reason}</span>
            {renderOpenSample ? renderOpenSample(sample) : <span />}
          </div>
        ))}
        {samples.length > kSamplesShown ? (
          <button
            type="button"
            className={clsx(styles.link, styles.more)}
            onClick={() => setAll(!all)}
          >
            {all ? "show fewer" : `show all ${formatNumber(samples.length)}`}
          </button>
        ) : null}
      </div>
    </Part>
  );
};

/** The stage names the sentinel docs use. */
const kStageNames: Record<SentinelEvent["stage"], string> = {
  model_input: "BeforeGenerate",
  model_output: "AfterGenerate",
  tool_call: "BeforeToolCall",
  tool_result: "AfterToolCall",
};

const kStageOrder: readonly string[] = Object.keys(kStageNames);

const kActionOrder: readonly string[] = [
  "reject",
  "terminate",
  "modify",
  "escalate",
  "proceed",
];

const isStage = (stage: string): stage is SentinelEvent["stage"] =>
  kStageOrder.includes(stage);

const stageName = (stage: string): string =>
  isStage(stage) ? kStageNames[stage] : stage;

const ordered = <T,>(
  record: Record<string, T>,
  order: readonly string[]
): [string, T][] => {
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return Object.entries(record).sort(([a], [b]) => rank(a) - rank(b));
};

const orderedStages = (steps: Record<string, StepCounts>) =>
  ordered(steps, kStageOrder);

const orderedActions = (actions: Record<string, number>) =>
  ordered(actions, kActionOrder);

const sum = (values: number[] | undefined): number =>
  (values ?? []).reduce((total, n) => total + n, 0);

const percent = (part: number, whole: number): string | undefined =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : undefined;

const notCheckedText = (unjudged: Record<string, number>): string => {
  const reasons = Object.entries(unjudged).filter(([, n]) => n > 0);
  const total = sum(reasons.map(([, n]) => n));
  if (total === 0) return "0";
  const [only] = reasons;
  if (reasons.length === 1 && only) return `${formatNumber(total)} ${only[0]}`;
  return `${formatNumber(total)} (${reasons.map(([r, n]) => `${r} ${formatNumber(n)}`).join(", ")})`;
};

const plural = (count: number, noun: string): string =>
  `${formatNumber(count)} ${noun}${count === 1 ? "" : "s"}`;
