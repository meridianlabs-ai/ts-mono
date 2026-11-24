import clsx from "clsx";
import { FC } from "react";

import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { Icon, IconName } from "../icons";

import styles from "./CopyButton.module.css";

interface CopyButtonProps {
  icon?: IconName;
  title?: string;
  value: string;
  className?: string;
  ariaLabel?: string;
}

export const CopyButton: FC<CopyButtonProps> = ({
  icon,
  title,
  value,
  className = "",
  ariaLabel = "Copy to clipboard",
}) => {
  const { copied, copy } = useCopyToClipboard();

  return (
    <button
      type="button"
      className={clsx("copy-button", styles.copyButton, className)}
      onClick={() => copy(value)}
      aria-label={ariaLabel}
      disabled={copied}
      title={title}
    >
      <Icon
        name={copied ? "confirm" : (icon ?? "copy")}
        className={copied ? "primary" : undefined}
      />
    </button>
  );
};
