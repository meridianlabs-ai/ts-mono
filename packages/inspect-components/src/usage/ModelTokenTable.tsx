import clsx from "clsx";
import { FC, Fragment } from "react";

import { formatNumber } from "@tsmono/util";

import { ModelUsageData } from "./ModelUsagePanel";
import styles from "./ModelTokenTable.module.css";

interface ModelTokenTableProps {
  model_usage: Record<string, ModelUsageData>;
  samples?: number;
  className?: string | string[];
}

type CategoryKey =
  | "input"
  | "cacheRead"
  | "cacheWrite"
  | "output"
  | "reasoning";

const CAT_ORDER: CategoryKey[] = [
  "input",
  "cacheRead",
  "cacheWrite",
  "output",
  "reasoning",
];

const CAT_LABEL: Record<CategoryKey, string> = {
  input: "Input",
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
  output: "Output",
  reasoning: "Reasoning",
};

const CAT_SWATCH: Record<CategoryKey, string> = {
  input: styles.catInput!,
  cacheRead: styles.catCacheRead!,
  cacheWrite: styles.catCacheWrite!,
  output: styles.catOutput!,
  reasoning: styles.catReasoning!,
};

const categoryValue = (
  usage: ModelUsageData,
  key: CategoryKey
): number => {
  switch (key) {
    case "input":
      return usage.input_tokens ?? 0;
    case "cacheRead":
      return usage.input_tokens_cache_read ?? 0;
    case "cacheWrite":
      return usage.input_tokens_cache_write ?? 0;
    case "output":
      return usage.output_tokens ?? 0;
    case "reasoning":
      return usage.reasoning_tokens ?? 0;
  }
};

const compositionTotal = (usage: ModelUsageData): number =>
  CAT_ORDER.reduce((a, k) => a + categoryValue(usage, k), 0);

const usageTotal = (usage: ModelUsageData): number =>
  usage.total_tokens || compositionTotal(usage);

export const ModelTokenTable: FC<ModelTokenTableProps> = ({
  model_usage,
  samples,
  className,
}) => {
  const models = Object.keys(model_usage).filter((k) => model_usage[k]);
  if (models.length === 0) return null;

  const usedKeys = CAT_ORDER.filter((k) =>
    models.some((m) => categoryValue(model_usage[m]!, k) > 0)
  );
  const showPerSample = samples !== undefined && samples > 0;

  return (
    <div className={clsx(styles.wrapper, className)}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Model</th>
            <th>Composition</th>
            <th>Breakdown</th>
            {showPerSample && <th className={styles.num}>Per sample</th>}
            <th className={styles.num}>Total tokens</th>
          </tr>
        </thead>
        <tbody>
          {models.map((modelId) => {
            const usage = model_usage[modelId]!;
            const composeSum = compositionTotal(usage);
            const total = usageTotal(usage);
            const cacheRate =
              total > 0
                ? Math.round(((usage.input_tokens_cache_read ?? 0) / total) * 100)
                : 0;
            const outputRate =
              total > 0
                ? Math.round(((usage.output_tokens ?? 0) / total) * 100)
                : 0;
            return (
              <tr key={modelId} className={styles.modelRow}>
                <td className={styles.modelCell}>
                  <span className={styles.modelName}>{modelId}</span>
                  <span className={styles.modelTotal}>
                    {formatNumber(total)}
                    <small>tokens</small>
                  </span>
                </td>
                <td className={styles.composeCell}>
                  <div className={styles.stack}>
                    {composeSum > 0 &&
                      CAT_ORDER.map((k) => {
                        const v = categoryValue(usage, k);
                        if (!v) return null;
                        return (
                          <span
                            key={k}
                            className={CAT_SWATCH[k]}
                            style={{ width: `${(v / composeSum) * 100}%` }}
                          />
                        );
                      })}
                  </div>
                  <div className={styles.pcts}>
                    <span>{cacheRate}% cache read</span>
                    <span>{outputRate}% output</span>
                  </div>
                </td>
                <td>
                  <dl className={styles.breakdown}>
                    {CAT_ORDER.map((k) => {
                      const v = categoryValue(usage, k);
                      if (!v) return null;
                      return (
                        <Fragment key={k}>
                          <dt className={styles.breakdownLabel}>
                            <span
                              className={clsx(styles.swatchSmall, CAT_SWATCH[k])}
                            />
                            {CAT_LABEL[k]}
                          </dt>
                          <dd className={styles.breakdownLeader} />
                          <dd className={styles.breakdownValue}>
                            {formatNumber(v)}
                          </dd>
                        </Fragment>
                      );
                    })}
                  </dl>
                </td>
                {showPerSample && (
                  <td className={clsx(styles.num, styles.perSampleCell)}>
                    {formatNumber(Math.round(total / samples))}
                    <span className={styles.perSampleSub}>avg / sample</span>
                  </td>
                )}
                <td className={clsx(styles.num, styles.totalCell)}>
                  {formatNumber(total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.legend}>
        {usedKeys.map((k) => (
          <span key={k} className={styles.item}>
            <span className={clsx(styles.swatch, CAT_SWATCH[k])} />
            {CAT_LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  );
};
