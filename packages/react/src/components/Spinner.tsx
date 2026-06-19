import clsx from "clsx";
import { FC, HTMLAttributes } from "react";

import styles from "./Spinner.module.css";

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  /** Screen-reader label; rendered visually hidden. */
  label?: string;
}

/** Indeterminate loading spinner (sized/colored via className). */
export const Spinner: FC<SpinnerProps> = ({
  label = "Loading...",
  className,
  ...rest
}) => (
  <div className={clsx(styles.spinner, className)} role="status" {...rest}>
    <span className="visually-hidden">{label}</span>
  </div>
);
