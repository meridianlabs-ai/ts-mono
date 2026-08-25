import clsx from "clsx";
import { FC, useState } from "react";

import { useComponentIcons } from "./ComponentIconContext";
import styles from "./CopyButton.module.css";

const toCopyError = (error: unknown): Error =>
  error instanceof Error ? error : new Error("Failed to copy");

interface CopyButtonProps {
  icon?: string;
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
  const icons = useComponentIcons();
  const [isCopied, setIsCopied] = useState(false);

  const handleClick = async (): Promise<void> => {
    // No value blocks (?., ??, ternary) inside the try/catch — React
    // Compiler can't lower those yet and would bail out the component.
    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
      if (onCopySuccess) {
        onCopySuccess();
      }

      // Reset copy state after delay
      setTimeout(() => {
        setIsCopied(false);
      }, 1250);
    } catch (error) {
      if (onCopyError) {
        onCopyError(toCopyError(error));
      }
    }
  };

  return (
    <button
      type="button"
      className={clsx("copy-button", styles.copyButton, className)}
      onClick={() => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        handleClick();
      }}
      aria-label={ariaLabel}
      disabled={isCopied}
      title={title}
    >
      <i
        className={isCopied ? `${icons.confirm} primary` : (icon ?? icons.copy)}
        aria-hidden="true"
      />
    </button>
  );
};
