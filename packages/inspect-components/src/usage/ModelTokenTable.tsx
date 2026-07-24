import clsx from "clsx";
import { FC, Fragment } from "react";

import { formatConfigValue } from "@tsmono/inspect-common/utils";
import { formatNumber } from "@tsmono/util";

import styles from "./ModelTokenTable.module.css";
import { ModelUsageData } from "./ModelUsagePanel";

interface ModelTokenTableProps {
  model_usage?: Record<string, ModelUsageData>;
  samples?: number;
  className?: string | string[];
  model_configs?: Record<string, Record<string, unknown>>;
  model_args?: Record<string, Record<string, unknown>>;
  model_aliases?: Record<string, string>;
  rowKeys?: string[];
  showTokenColumns?: boolean;
}

type CategoryKey =
  "input" | "cacheRead" | "cacheWrite" | "output" | "reasoning";

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

const categoryValue = (usage: ModelUsageData, key: CategoryKey): number => {
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
  model_configs,
  model_args,
  model_aliases,
  rowKeys,
  showTokenColumns = true,
}) => {
  const models =
    rowKeys ??
    (model_usage ? Object.keys(model_usage).filter((k) => model_usage[k]) : []);
  if (models.length === 0) return null;

  const showPerSample =
    showTokenColumns && samples !== undefined && samples > 0;

  return (
    <div className={clsx(styles.wrapper, className)}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Model</th>
            {showTokenColumns && (
              <>
                <th>Composition</th>
                <th>Breakdown</th>
              </>
            )}
            {showPerSample && <th className={styles.num}>Per sample</th>}
          </tr>
        </thead>
        <tbody>
          {models.map((modelId) => {
            const usage = model_usage?.[modelId];
            const composeSum = usage ? compositionTotal(usage) : 0;
            const total = usage ? usageTotal(usage) : 0;
            const cacheRate =
              usage && total > 0
                ? Math.round(
                    ((usage.input_tokens_cache_read ?? 0) / total) * 100
                  )
                : 0;
            const outputRate =
              usage && total > 0
                ? Math.round(((usage.output_tokens ?? 0) / total) * 100)
                : 0;
            return (
              <Fragment key={modelId}>
                <tr className={styles.modelRow}>
                  <td className={styles.modelCell}>
                    <span className={styles.modelName}>{modelId}</span>
                    {model_aliases?.[modelId] && (
                      <span className={styles.modelAlias}>
                        {model_aliases[modelId]}
                      </span>
                    )}
                    {showTokenColumns && (
                      <span className={styles.modelTotal}>
                        {formatNumber(total)}
                        <small>tokens</small>
                      </span>
                    )}
                    {(() => {
                      const cfg = model_configs?.[modelId];
                      const args = model_args?.[modelId];
                      const cfgEntries = cfg
                        ? Object.entries(cfg).filter(([, v]) => v != null)
                        : [];
                      const argEntries = args
                        ? Object.entries(args).filter(([, v]) => v != null)
                        : [];
                      if (cfgEntries.length === 0 && argEntries.length === 0)
                        return null;
                      const renderSection = (
                        label: string,
                        entries: [string, unknown][]
                      ) => (
                        <>
                          <div className={styles.configSectionLabel}>
                            {label}
                          </div>
                          <dl className={styles.configTable}>
                            {entries.map(([k, v]) => (
                              <Fragment key={k}>
                                <dt className={styles.configKey}>{k}</dt>
                                <dd className={styles.configVal}>
                                  {formatConfigValue(v, "null")}
                                </dd>
                              </Fragment>
                            ))}
                          </dl>
                        </>
                      );
                      return (
                        <div className={styles.configSection}>
                          {cfgEntries.length > 0 &&
                            renderSection("config", cfgEntries)}
                          {argEntries.length > 0 &&
                            renderSection("args", argEntries)}
                        </div>
                      );
                    })()}
                  </td>
                  {/* rows without usage still need cells here to keep
                      later columns aligned */}
                  {showTokenColumns && !usage && <td colSpan={2} />}
                  {showTokenColumns && usage && (
                    <>
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
                                  style={{
                                    width: `${(v / composeSum) * 100}%`,
                                  }}
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
                                    className={clsx(
                                      styles.swatchSmall,
                                      CAT_SWATCH[k]
                                    )}
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
                    </>
                  )}
                  {showPerSample && !usage && <td />}
                  {showPerSample && usage && (
                    <td className={clsx(styles.num, styles.perSampleCell)}>
                      {formatNumber(Math.round(total / samples))}
                      <span className={styles.perSampleSub}>avg / sample</span>
                    </td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
