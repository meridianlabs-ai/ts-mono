import { clsx } from "clsx";
import { FC } from "react";

import {
  ANSIDisplay,
  Card,
  CardBody,
  CardHeader,
} from "@tsmono/react/components";

import styles from "./ErrorPanel.module.css";

interface ErrorPanelProps {
  error?: string;
  traceback?: string;
}

export const ErrorPanel: FC<ErrorPanelProps> = ({ error, traceback }) => {
  return (
    <Card className={clsx(styles.container)}>
      <CardHeader type="modern">Error</CardHeader>
      <CardBody>
        <div className={clsx("text-size-smaller")}>{error}</div>

        {traceback && (
          <ANSIDisplay
            className={clsx(styles.traceback, "text-size-smaller")}
            output={traceback}
          />
        )}
      </CardBody>
    </Card>
  );
};
