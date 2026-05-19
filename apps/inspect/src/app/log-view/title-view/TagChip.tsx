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
  >
    {label}
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
