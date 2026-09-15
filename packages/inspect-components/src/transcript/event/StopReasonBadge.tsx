import clsx from "clsx";
import { FC } from "react";

import type {
  ChatCompletionChoice,
  StopDetails,
} from "@tsmono/inspect-common/types";
import { MetaDataGrid } from "@tsmono/inspect-components/content";

import styles from "./StopReasonBadge.module.css";

type StopReason = ChatCompletionChoice["stop_reason"];

const TONE_CLASS = {
  neutral: styles.neutral,
  amber: styles.amber,
  blue: styles.blue,
  rose: styles.rose,
  gray: styles.gray,
} as const;
type Tone = keyof typeof TONE_CLASS;

// Tone is a design call (kept subtle). Exhaustive over the generated union,
// but read through a string-keyed view: a log written by a newer inspect_ai
// can carry a stop reason this build doesn't know, and that falls back to gray.
const STOP_TONE = {
  stop: "neutral",
  max_tokens: "amber",
  model_length: "amber",
  tool_calls: "blue",
  content_filter: "rose",
  unknown: "gray",
} satisfies Record<StopReason, Tone>;
const stopTone: Partial<Record<string, Tone>> = STOP_TONE;

interface StopReasonBadgeProps {
  reason: StopReason;
  details?: StopDetails | null;
}

// `categories` is the list that `category`/`explanation` summarize, so it is
// omitted here. Every remaining non-empty scalar (category, explanation, type,
// and any future key) renders as a label/value row, so adding fields to
// StopDetails needs no change here. `category` and `type` lead; longer text
// (e.g. explanation) follows.
const detailEntries = (
  details: StopDetails | null | undefined
): Record<string, string> => {
  if (!details) return {};
  const scalars: Record<string, string> = {};
  for (const [k, v] of Object.entries(details) as [string, unknown][]) {
    if (k === "categories" || typeof v !== "string" || v === "") continue;
    scalars[k] = v;
  }
  const ordered: Record<string, string> = {};
  for (const k of ["category", "type"]) {
    if (k in scalars) {
      ordered[k] = scalars[k]!;
      delete scalars[k];
    }
  }
  return { ...ordered, ...scalars };
};

export const StopReasonBadge: FC<StopReasonBadgeProps> = ({
  reason,
  details,
}) => {
  const toneClass = TONE_CLASS[stopTone[reason] ?? "gray"];
  const entries = detailEntries(details);

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span
          className={clsx(
            "text-size-small",
            "text-style-label",
            "text-style-secondary",
            styles.label
          )}
        >
          Stop Reason
        </span>
        <span className={clsx(styles.badge, toneClass)}>{reason}</span>
      </div>
      {Object.keys(entries).length > 0 && (
        <MetaDataGrid entries={entries} options={{ plain: true }} />
      )}
    </div>
  );
};
