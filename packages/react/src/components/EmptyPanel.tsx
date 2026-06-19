import { FC, ReactNode } from "react";

import styles from "./EmptyPanel.module.css";

interface EmptyPanelProps {
  children?: ReactNode;
}

export const EmptyPanel: FC<EmptyPanelProps> = ({ children }) => {
  return (
    <div className={styles.panel}>
      <div className={styles.container}>
        <div>{children}</div>
      </div>
    </div>
  );
};
