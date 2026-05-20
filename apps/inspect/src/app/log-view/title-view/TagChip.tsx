import clsx from "clsx";
import { FC } from "react";

import { ApplicationIcons } from "../../appearance/icons";

import styles from "./TagChip.module.css";

interface TagChipProps {
  label: string;
  // When true, render the chip with the "pending add" visual variant
  // (used inside the editor while there are uncommitted adds).
  isNew?: boolean;
  // Optional remove-callback. When provided, the chip renders a small
  // × button on the right (used inside the editor only).
  onRemove?: () => void;
}

export const TagChip: FC<TagChipProps> = ({ label, isNew, onRemove }) => (
  <span
    className={clsx(styles.chip, isNew && styles.chipNew, "text-size-smaller")}
    // Truncated labels stay discoverable on hover. Without this, a user
    // who entered a long tag has no way to read it back from the header.
    title={label}
  >
    {/* The label lives in its own bounded element so a runaway-length
       tag can't widen the whole chip — which would otherwise push the
       inline Edit button off the right edge of the viewer header. */}
    <span className={styles.chipLabel}>{label}</span>
    {onRemove && (
      <button
        type="button"
        className={styles.chipRemove}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <i className={ApplicationIcons.close} />
      </button>
    )}
  </span>
);
