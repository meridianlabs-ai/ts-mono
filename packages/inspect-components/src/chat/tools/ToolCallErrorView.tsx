import clsx from "clsx";
import { FC } from "react";

import type { ToolCallError } from "@tsmono/inspect-common/types";
import { ContentText } from "@tsmono/react/components";

import styles from "./ToolCallErrorView.module.css";

interface ToolCallErrorViewProps {
  error: ToolCallError;
  className?: string | string[];
}

export const ToolCallErrorView: FC<ToolCallErrorViewProps> = ({
  error,
  className,
}) => {
  return (
    <div className={clsx(styles.error, "text-size-smallest", className)}>
      <div className={styles.message}>
        <ContentText text={error.message} />
      </div>
    </div>
  );
};
