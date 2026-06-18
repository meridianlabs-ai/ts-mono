import clsx from "clsx";
import { FC } from "react";

import { Spinner } from "@tsmono/react/components";

import styles from "./RunningNoSamples.module.css";

interface RunningNoSamplesProps {}

export const RunningNoSamples: FC<RunningNoSamplesProps> = () => {
  return (
    <div className={clsx(styles.panel)}>
      <div className={clsx(styles.container, "text-size-smaller")}>
        <Spinner className={styles.spinner} label="starting..." />
        <div className={clsx(styles.text)}>starting....</div>
      </div>
    </div>
  );
};
