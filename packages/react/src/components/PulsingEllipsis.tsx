import { FC } from "react";

import styles from "./PulsingEllipsis.module.css";

interface PulsingEllipsisProps {
  text?: string;
}

export const PulsingEllipsis: FC<PulsingEllipsisProps> = ({
  text = "Loading",
}) => {
  return (
    <span role="status" className={styles.label}>
      {text}
      <span className={styles.ell} aria-hidden="true">
        <i>.</i>
        <i>.</i>
        <i>.</i>
      </span>
      <span className="visually-hidden">...</span>
    </span>
  );
};
