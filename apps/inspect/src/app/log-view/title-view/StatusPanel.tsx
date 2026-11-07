import { FC } from "react";

import { Icon, IconName } from "@tsmono/react/icons";

import styles from "./StatusPanel.module.css";

interface StatusProps {
  sampleCount: number;
}

export const CancelledPanel: FC<StatusProps> = ({ sampleCount }) => {
  return (
    <StatusPanel icon="logInfo" status="Cancelled" sampleCount={sampleCount} />
  );
};

export const ErroredPanel: FC<StatusProps> = ({ sampleCount }) => {
  return (
    <StatusPanel
      icon="logError"
      status="Task Failed"
      sampleCount={sampleCount}
    />
  );
};

export const RunningPanel: FC<StatusProps> = ({ sampleCount }) => {
  return (
    <StatusPanel icon="running" status="Running" sampleCount={sampleCount} />
  );
};

export interface StatusPanelProps {
  icon: IconName;
  status: string;
  sampleCount: number;
}

export const StatusPanel: FC<StatusPanelProps> = ({
  icon,
  status,
  sampleCount,
}) => {
  return (
    <div className={styles.statusPanel}>
      <Icon name={icon} className={styles.statusIcon} />
      <div>
        <div>{status}</div>
        <div>
          ({sampleCount} {sampleCount === 1 ? "sample" : "samples"})
        </div>
      </div>
    </div>
  );
};
