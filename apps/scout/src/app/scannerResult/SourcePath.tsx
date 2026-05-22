import { FC } from "react";

import { CopyButton } from "@tsmono/react/components";
import { centerTruncate } from "@tsmono/util";

import styles from "./SourcePath.module.css";

interface SourcePathProps {
  uri: string;
  /** Maximum display length before truncation. Default 58 (≈ head 20 + ellipsis + tail 36). */
  maxLength?: number;
  className?: string;
}

export const SourcePath: FC<SourcePathProps> = ({
  uri,
  maxLength = 58,
  className,
}) => {
  const display = centerTruncate(uri, maxLength);
  return (
    <span className={className ?? styles.sourcePath} title={uri}>
      <span className={styles.pathText}>{display}</span>
      <CopyButton value={uri} ariaLabel="Copy source path" />
    </span>
  );
};
