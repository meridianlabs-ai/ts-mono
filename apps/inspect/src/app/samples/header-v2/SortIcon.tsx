import clsx from "clsx";
import { FC } from "react";

import styles from "./SortIcon.module.css";

export type SortDir = "asc" | "desc" | "none";

interface SortIconProps {
  dir: SortDir;
}

/**
 * Stacked-triangle sort indicator. Top triangle filled when ascending,
 * bottom filled when descending, both faint when unsorted on this
 * column. Drawn with CSS borders — no SVG, no images.
 */
export const SortIcon: FC<SortIconProps> = ({ dir }) => {
  const active = dir === "asc" || dir === "desc";
  return (
    <span aria-hidden className={styles.root}>
      <span
        className={clsx(
          styles.up,
          dir === "asc" ? styles.activeArrow : styles.dimArrow,
          active && dir !== "asc" && styles.faded
        )}
      />
      <span
        className={clsx(
          styles.down,
          dir === "desc" ? styles.activeArrow : styles.dimArrow,
          active && dir !== "desc" && styles.faded
        )}
      />
    </span>
  );
};
