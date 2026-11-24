import clsx from "clsx";
import { forwardRef } from "react";

import { Icon, IconName } from "@tsmono/react/icons";

import styles from "./Chip.module.css";

interface ChipProps {
  icon?: IconName;
  label?: string;
  value: string;
  title?: string;
  closeTitle?: string;
  onClick?: () => void;
  onClose?: (event?: React.MouseEvent | React.KeyboardEvent) => void;
  className?: string | string[];
}

/**
 * A bordered label/value pair. With `onClick`, its body is a button, and the
 * forwarded ref points at that button so a popover it opens can anchor to it
 * and return focus to it.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  (
    { icon, label, value, title, closeTitle, onClick, onClose, className },
    ref
  ) => {
    const content = (
      <>
        {icon ? <Icon name={icon} className={styles.icon} /> : undefined}
        {label ? <span className={styles.label}>{label}</span> : undefined}
        <span>{value}</span>
      </>
    );
    return (
      <div
        className={clsx(styles.chip, className)}
        title={onClick ? undefined : title}
      >
        {onClick ? (
          <button
            ref={ref}
            type="button"
            className={clsx(styles.content, styles.button)}
            title={title}
            onClick={onClick}
          >
            {content}
          </button>
        ) : (
          <span className={styles.content}>{content}</span>
        )}
        {onClose ? (
          <button
            type="button"
            className={styles.closeIcon}
            title={closeTitle}
            aria-label={closeTitle ?? `Remove ${value}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose(event);
            }}
          >
            <Icon name="closeLarge" />
          </button>
        ) : undefined}
      </div>
    );
  }
);

Chip.displayName = "Chip";
