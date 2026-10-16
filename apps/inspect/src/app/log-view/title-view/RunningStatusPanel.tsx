import clsx from "clsx";
import { FC } from "react";

import { Icon } from "@tsmono/react/icons";

import { RunningMetric } from "../../../client/api/types";

import styles from "./RunningStatusPanel.module.css";

export interface RunningPanelProps {
  sampleCount: number;
  displayMetrics?: RunningMetric[];
}

export const RunningStatusPanel: FC<RunningPanelProps> = ({ sampleCount }) => {
  return (
    <div>
      <div className={clsx(styles.statusContainer)}>
        <div className={clsx(styles.status)}>
          <Icon name="running" className={styles.icon} />
          <div
            className={clsx(
              styles.statusText,
              "text-style-label",
              "text-size-smaller"
            )}
          >
            Running ({sampleCount} samples)
          </div>
        </div>
      </div>
    </div>
  );
};
