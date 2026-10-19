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

export const Chip = forwardRef<HTMLDivElement, ChipProps>(
  (
    { icon, label, value, title, closeTitle, onClick, onClose, className },
    ref
  ) => {
    return (
      // The chip's own click is a shortcut onto content that is reachable
      // elsewhere; the close button below is a real control.
      <div
        ref={ref}
        className={clsx(styles.chip, className)}
        role="presentation"
        onClick={onClick}
        title={title}
      >
        {icon ? (
          <Icon
            name={icon}
            className={clsx(
              styles.icon,
              onClick ? styles.clickable : undefined
            )}
          />
        ) : undefined}
        {label ? (
          <span
            className={clsx(
              styles.label,
              onClick ? styles.clickable : undefined
            )}
          >
            {label}
          </span>
        ) : undefined}
        <span className={clsx(onClick ? styles.clickable : undefined)}>
          {value}
        </span>
        {onClose ? (
          <button
            type="button"
            className={clsx(styles.closeIcon, styles.clickable)}
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
