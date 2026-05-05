import clsx from "clsx";
import { FC } from "react";

import { formatNumber } from "@tsmono/util";

import styles from "./ModelUsagePanel.module.css";

export interface ModelUsageData {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  reasoning_tokens?: number | null;
  input_tokens_cache_read?: number | null;
  input_tokens_cache_write?: number | null;
}

interface ModelUsageProps {
  usage: ModelUsageData;
  className?: string | string[];
}

type CategoryKey =
  | "input"
  | "cacheRead"
  | "cacheWrite"
  | "output"
  | "reasoning";

interface Category {
  key: CategoryKey;
  label: string;
  value: number;
  swatchClass: string;
}

const CAT_ORDER: CategoryKey[] = [
  "input",
  "cacheRead",
  "cacheWrite",
  "output",
  "reasoning",
];

const CAT_LABEL: Record<CategoryKey, string> = {
  input: "input",
  cacheRead: "cache read",
  cacheWrite: "cache write",
  output: "output",
  reasoning: "reasoning",
};

const CAT_SWATCH: Record<CategoryKey, string> = {
  input: styles.catInput!,
  cacheRead: styles.catCacheRead!,
  cacheWrite: styles.catCacheWrite!,
  output: styles.catOutput!,
  reasoning: styles.catReasoning!,
};

const buildCategories = (usage: ModelUsageData): Category[] => {
  const values: Record<CategoryKey, number> = {
    input: usage.input_tokens ?? 0,
    cacheRead: usage.input_tokens_cache_read ?? 0,
    cacheWrite: usage.input_tokens_cache_write ?? 0,
    output: usage.output_tokens ?? 0,
    reasoning: usage.reasoning_tokens ?? 0,
  };
  return CAT_ORDER.filter((k) => values[k] > 0).map((k) => ({
    key: k,
    label: CAT_LABEL[k],
    value: values[k],
    swatchClass: CAT_SWATCH[k],
  }));
};

export const ModelUsagePanel: FC<ModelUsageProps> = ({ usage, className }) => {
  if (!usage) {
    return null;
  }

  const categories = buildCategories(usage);
  const compositionTotal = categories.reduce((a, c) => a + c.value, 0);
  const total = usage.total_tokens || compositionTotal;

  const inputAll =
    (usage.input_tokens ?? 0) +
    (usage.input_tokens_cache_read ?? 0) +
    (usage.input_tokens_cache_write ?? 0);
  const outputAll =
    (usage.output_tokens ?? 0) + (usage.reasoning_tokens ?? 0);
  const denominator = inputAll + outputAll || total || 1;
  const inputPct = Math.round((inputAll / denominator) * 100);
  const outputPct = Math.max(0, 100 - inputPct);

  return (
    <div className={clsx(styles.strip, className)}>
      <div className={styles.cell}>
        <span className={styles.lab}>Total tokens</span>
        <span className={styles.val}>{formatNumber(total)}</span>
        {compositionTotal > 0 && (
          <span className={styles.sub}>
            {inputPct}% input · {outputPct}% output
          </span>
        )}
      </div>
      <div className={styles.cell}>
        <span className={styles.lab}>Composition</span>
        <div className={styles.barRow}>
          <div className={styles.stack}>
            {categories.map((c) => (
              <span
                key={c.key}
                className={c.swatchClass}
                style={{ width: `${(c.value / compositionTotal) * 100}%` }}
              />
            ))}
          </div>
        </div>
        <div className={styles.breakdown}>
          {categories.map((c) => (
            <span key={c.key}>
              <span className={clsx(styles.swatch, c.swatchClass)} />
              <b>{formatNumber(c.value)}</b> {c.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
