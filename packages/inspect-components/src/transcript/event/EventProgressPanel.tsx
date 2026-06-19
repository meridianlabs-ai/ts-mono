import clsx from "clsx";
import { FC } from "react";

import { Spinner } from "@tsmono/react/components";

import styles from "./EventProgressPanel.module.css";

interface EventProgressPanelProps {
  text: string;
}

export const EventProgressPanel: FC<EventProgressPanelProps> = ({ text }) => {
  return (
    <div className={clsx(styles.panel)}>
      <div className={clsx(styles.container)}>
        <PanelSpinner />
        <div className={clsx("text-size-smaller", styles.text)}>{text}</div>
      </div>
    </div>
  );
};

const PanelSpinner: FC = () => (
  <Spinner className={styles.spinner} label="generating..." />
);
