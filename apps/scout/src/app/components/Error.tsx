import clsx from "clsx";
import { FC } from "react";

import { Icon } from "@tsmono/react/icons";

import styles from "./Error.module.css";

interface ErrorProps {
  error: string;
  refusal?: boolean;
}

export const Error: FC<ErrorProps> = ({ error, refusal }) => {
  const message = refusal ? "Refusal" : error;
  return (
    <div className={clsx(styles.error, refusal && styles.refusal)}>
      <Icon name={refusal ? "refuse" : "error"} />
      {message}
    </div>
  );
};
