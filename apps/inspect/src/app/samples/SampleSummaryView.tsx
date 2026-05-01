import clsx from "clsx";
import { FC, Fragment, ReactNode } from "react";

import { EvalSample, ProvenanceData } from "@tsmono/inspect-common/types";
import { inputString } from "@tsmono/inspect-common/utils";
import { RenderedText } from "@tsmono/inspect-components/content";
import { arrayToString } from "@tsmono/util";

import {
  EvalSampleTarget,
  EvalSampleWorkingTime,
} from "../../@types/extraInspect";
import { SampleSummary } from "../../client/api/types";
import { useSampleDescriptor, useSelectedScores } from "../../state/hooks";
import { useStore } from "../../state/store";
import { formatDateTime, formatTime } from "../../utils/format";
import { truncateMarkdown } from "../../utils/markdown";

import { SamplesDescriptor } from "./descriptor/samplesDescriptor";
import { SampleErrorView } from "./error/SampleErrorView";
import styles from "./SampleSummaryView.module.css";
import { isCancelled } from "./status/sampleStatus";

const kMaxCellTextLength = 128;

interface SampleSummaryViewProps {
  parent_id: string;
  sample: SampleSummary | EvalSample;
}

interface SampleFields {
  id: string | number;
  epoch: number;
  input: string[];
  target: EvalSampleTarget;
  answer?: string;
  limit?: string;
  retries?: number;
  working_time?: EvalSampleWorkingTime;
  total_time?: EvalSample["total_time"];
  error?: string;
  cancelled?: boolean;
}

function isEvalSample(
  sample: SampleSummary | EvalSample
): sample is EvalSample {
  return "store" in sample;
}

const resolveSample = (
  sample: SampleSummary | EvalSample,
  sampleDescriptor: SamplesDescriptor
): SampleFields => {
  const input = inputString(sample.input);
  if (isEvalSample(sample) && sample.choices && sample.choices.length > 0) {
    input.push("");
    input.push(
      ...sample.choices.map((choice, index) => {
        return `${String.fromCharCode(65 + index)}) ${choice}`;
      })
    );
  }

  const target = sample.target;
  const answer =
    sample && sampleDescriptor
      ? sampleDescriptor.selectedScorerDescriptor(sample)?.answer()
      : undefined;
  const limit = isEvalSample(sample) ? sample.limit?.type : undefined;
  const working_time = isEvalSample(sample) ? sample.working_time : undefined;
  const total_time = isEvalSample(sample) ? sample.total_time : undefined;
  const cancelled = isCancelled(sample);
  const error = isEvalSample(sample) ? sample.error?.message : undefined;
  const retries = isEvalSample(sample)
    ? sample.error_retries?.length
    : sample.retries;

  return {
    id: sample.id,
    epoch: sample.epoch,
    input,
    target,
    answer,
    limit,
    retries,
    working_time,
    total_time,
    error,
    cancelled,
  };
};

interface MetaItem {
  key: string;
  content: ReactNode;
  title?: string;
}

const MetaLine: FC<{ items: MetaItem[] }> = ({ items }) => (
  <div className={clsx(styles.metaLine, "text-size-smaller")}>
    {items.map((item, idx) => (
      <Fragment key={item.key}>
        {idx > 0 && <span className={styles.metaSep}>·</span>}
        <span title={item.title}>{item.content}</span>
      </Fragment>
    ))}
  </div>
);

const FieldLabel: FC<{ children: ReactNode }> = ({ children }) => (
  <div className={clsx(styles.fieldLabel)} data-unsearchable={true}>
    {children}
  </div>
);

/**
 * The single-sample header that sits above the transcript / messages /
 * scores tabs. Renders sample id and meta on a single row, with
 * Input / Target / Answer beneath, and a right-hand score panel.
 *
 * The score panel is currently a simple stack of label-over-value
 * pairs; the next stage of the V2 redesign replaces this with a
 * dedicated `ScorePanel` (chips / sortable grid + view toggle).
 */
export const SampleSummaryView: FC<SampleSummaryViewProps> = ({
  parent_id,
  sample,
}) => {
  const sampleDescriptor = useSampleDescriptor();
  const selectedScores = useSelectedScores();
  const taskName = useStore((state) => state.log.selectedLogDetails?.eval.task);
  if (!sampleDescriptor) {
    return undefined;
  }
  const fields = resolveSample(sample, sampleDescriptor);

  const scoreEntries =
    selectedScores
      ?.map((scoreLabel) => ({
        label: selectedScores.length === 1 ? "Score" : scoreLabel.name,
        value:
          sampleDescriptor.evalDescriptor.score(sample, scoreLabel)?.render() ??
          "",
      }))
      .filter((entry) => entry.value !== "") ?? [];

  // Two-column grid widens the right side once the score panel needs
  // room (3+ scores).
  const wideRight = scoreEntries.length >= 3;

  const metaItems: MetaItem[] = [
    {
      key: "id",
      content: <span className={styles.metaId}>{String(fields.id)}</span>,
    },
  ];
  if (taskName) {
    metaItems.push({ key: "task", content: taskName });
  }
  metaItems.push({ key: "epoch", content: `Epoch ${fields.epoch}` });
  if (fields.total_time) {
    metaItems.push({
      key: "time",
      content: formatTime(fields.total_time),
      title:
        fields.working_time !== undefined && fields.working_time !== null
          ? `Working time: ${formatTime(fields.working_time)}`
          : undefined,
    });
  }
  if (fields.limit) {
    metaItems.push({ key: "limit", content: `Limit: ${fields.limit}` });
  }
  if (
    fields.retries !== undefined &&
    fields.retries !== null &&
    fields.retries > 0
  ) {
    metaItems.push({ key: "retries", content: `Retries: ${fields.retries}` });
  }
  if (fields.cancelled) {
    metaItems.push({ key: "cancelled", content: "Cancelled" });
  }

  // Check if sample is invalidated (only available on full EvalSample)
  const invalidation: ProvenanceData | null | undefined = isEvalSample(sample)
    ? sample.invalidation
    : undefined;

  return (
    <div id={`sample-heading-${parent_id}`} className={styles.root}>
      {invalidation && <InvalidationBanner invalidation={invalidation} />}
      <div className={clsx(styles.layout, wideRight && styles.wideRight)}>
        <div className={styles.left}>
          <MetaLine items={metaItems} />
          <div className={styles.fields}>
            <div className={styles.field}>
              <FieldLabel>Input</FieldLabel>
              <div className={clsx(styles.fieldValue, styles.clamp)}>
                <RenderedText
                  markdown={truncateMarkdown(
                    fields.input.join(" "),
                    kMaxCellTextLength
                  )}
                />
              </div>
            </div>
            {fields.target ? (
              <div className={clsx(styles.field, styles.fieldTarget)}>
                <FieldLabel>Target</FieldLabel>
                <div className={clsx(styles.fieldValue, styles.clamp)}>
                  <RenderedText
                    markdown={truncateMarkdown(
                      arrayToString(fields.target || "none"),
                      kMaxCellTextLength
                    )}
                    className={clsx("no-last-para-padding")}
                  />
                </div>
              </div>
            ) : null}
            {fields.answer ? (
              <div className={styles.field}>
                <FieldLabel>Answer</FieldLabel>
                <div className={clsx(styles.fieldValue, styles.clamp)}>
                  <RenderedText
                    markdown={truncateMarkdown(
                      fields.answer || "",
                      kMaxCellTextLength
                    )}
                    className={clsx("no-last-para-padding")}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {scoreEntries.length > 0 ? (
          <div className={styles.right}>
            <div className={styles.scoreList}>
              {scoreEntries.map((entry, idx) => (
                <div key={`score-${idx}`} className={styles.scoreItem}>
                  <FieldLabel>{entry.label}</FieldLabel>
                  <div className={styles.scoreItemValue}>{entry.value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {fields.error ? (
        <div className={styles.errorBlock}>
          <SampleErrorView message={fields.error} />
        </div>
      ) : null}
    </div>
  );
};

/**
 * Banner component to display when a sample has been invalidated.
 */
const InvalidationBanner: FC<{ invalidation: ProvenanceData }> = ({
  invalidation,
}) => {
  const formatTimestamp = (timestamp: string) => {
    try {
      return formatDateTime(new Date(timestamp));
    } catch {
      return timestamp;
    }
  };

  return (
    <div className={styles.invalidationBanner}>
      <div className={styles.invalidationIcon}>⚠</div>
      <div className={styles.invalidationContent}>
        <div className={styles.invalidationTitle}>Sample Invalidated</div>
        <div className={styles.invalidationDetails}>
          {invalidation.author && <span>By: {invalidation.author}</span>}
          {invalidation.timestamp && (
            <span>On: {formatTimestamp(invalidation.timestamp)}</span>
          )}
          {invalidation.reason && (
            <span className={styles.invalidationReason}>
              Reason: {invalidation.reason}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
