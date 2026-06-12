import clsx from "clsx";
import { FC, KeyboardEvent } from "react";

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
 * Badge display form of a label: "[M4]" / "E58" → "4" / "58". The full cite
 * stays in the badge tooltip so prose references like "[M4]" remain
 * traceable. Inline anchors keep the full text — they must read like the
 * prose they sit in.
 */
export const compactLabel = (label: string): string => {
  const inner = label.replace(/^\[/, "").replace(/\]$/, "");
  return inner.replace(/^[A-Za-z]+/, "") || inner;
};

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
  if (mode === "inline") {
    const onKeyDown = (e: KeyboardEvent) => {
      if (onActivate && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onActivate();
      }
    };
    return (
      <a
        className={clsx(styles.inline, className)}
        onClick={onActivate}
        onKeyDown={onActivate ? onKeyDown : undefined}
        tabIndex={onActivate ? 0 : undefined}
      >
        {label}
      </a>
    );
  }

  const compact = compactLabel(label);
  return (
    <span
      className={clsx(styles.badge, className)}
      onClick={onActivate}
      title={compact === label ? undefined : label}
    >
      {compact}
    </span>
  );
};
