import clsx from "clsx";
import { FC } from "react";

import { Icon } from "../icons";

import styles from "./ErrorPanel.module.css";

export interface DisplayError {
  message: string;
  stack?: string;
  displayStack?: boolean;
}

interface ErrorPanelProps {
  title: string;
  error: DisplayError;
}

export const ErrorPanel: FC<ErrorPanelProps> = ({ title, error }) => {
  const message = error.message;
  const stack = error.stack;

  return (
    <div
      data-testid="error-panel"
      className={clsx(styles.errorPanel, styles.centeredFlex)}
    >
      <div className={clsx(styles.heading, styles.centeredFlex)}>
        <div>
          <Icon name="error" className={styles.errorIcon} />
        </div>
        <div>{title || ""}</div>
      </div>
      <div className={styles.body}>
        <div>
          {message || ""}
          {stack && error.displayStack !== false && (
            <pre className={styles.stack}>
              <code>at {stack}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
