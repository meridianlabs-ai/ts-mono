import clsx from "clsx";
import { FC } from "react";

import styles from "./MessageLabel.module.css";

interface MessageLabelProps {
  /** The label text (e.g. "M3", "3", "[M2]"). */
  label: string;
  /** `badge` (top-right of a card) | `inline` (anchor inside running text). */
  mode?: "badge" | "inline";
  /** Activation handler — inline chips are navigation anchors. */
  onActivate?: () => void;
  className?: string | string[];
}

/**
 * Badge display form of a label: strips the surrounding cite brackets but
 * keeps the type letter, so "[M4]" → "M4" and "[E58]" → "E58". The full
 * cite stays in the badge tooltip; inline anchors keep the original text —
 * they must read like the prose they sit in.
 */
export const compactLabel = (label: string): string =>
  label.replace(/^\[/, "").replace(/\]$/, "");

/**
 * A filled monospace chip used for message position labels (top-right of a
 * message) and as an inline anchor in summary prose.
 */
export const MessageLabel: FC<MessageLabelProps> = ({
  label,
  mode = "badge",
  onActivate,
  className,
}) => {
  const inline = mode === "inline";
  const text = inline ? label : compactLabel(label);
  const classes = clsx(
    inline ? styles.inline : styles.badge,
    onActivate && styles.interactive,
    className
  );
  const title = text === label ? undefined : label;

  if (onActivate) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onActivate}
        title={title}
      >
        {text}
      </button>
    );
  }

  return (
    <span className={classes} title={title}>
      {text}
    </span>
  );
};
