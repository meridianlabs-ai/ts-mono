import clsx from "clsx";
import { FC, useState } from "react";

import { Icon, IconName } from "../icons";

import styles from "./CopyButton.module.css";

const toCopyError = (error: unknown): Error =>
  error instanceof Error ? error : new Error("Failed to copy");

interface CopyButtonProps {
  icon?: IconName;
  title?: string;
  value: string;
  onCopySuccess?: () => void;
  onCopyError?: (error: Error) => void;
  className?: string;
  ariaLabel?: string;
}

export const CopyButton: FC<CopyButtonProps> = ({
  icon,
  title,
  value,
  onCopySuccess,
  onCopyError,
  className = "",
  ariaLabel = "Copy to clipboard",
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleClick = (): void => {
    // Deferred so a missing clipboard (plain http on a LAN host) rejects into
    // the .catch instead of throwing synchronously from the click handler.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(() => {
        setIsCopied(true);
        onCopySuccess?.();
        setTimeout(() => {
          setIsCopied(false);
        }, 1250);
      })
      .catch((error: unknown) => {
        onCopyError?.(toCopyError(error));
      });
  };

  return (
    <button
      type="button"
      className={clsx("copy-button", styles.copyButton, className)}
      onClick={handleClick}
      aria-label={ariaLabel}
      disabled={isCopied}
      title={title}
    >
      <Icon
        name={isCopied ? "confirm" : (icon ?? "copy")}
        className={isCopied ? "primary" : undefined}
      />
    </button>
  );
};
