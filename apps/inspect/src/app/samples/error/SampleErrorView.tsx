import clsx from "clsx";
import { FC } from "react";

import { Icon } from "@tsmono/react/icons";

import { errorType } from "./error";
import styles from "./SampleErrorView.module.css";

interface SampleErrorViewProps {
  message?: string;
}

/**
 * Component to display a styled error message.
 */
export const SampleErrorView: FC<SampleErrorViewProps> = ({ message }) => {
  const type = errorType(message);

  return (
    <div
      className={clsx(
        styles.body,
        isCanceledError(type) ? styles.safe : undefined
      )}
    >
      <Icon name="error" className={styles.iconSmall} />
      <div className={styles.message}>{type}</div>
    </div>
  );
};

const isCanceledError = (type?: string) => {
  return type === "CancelledError";
};
