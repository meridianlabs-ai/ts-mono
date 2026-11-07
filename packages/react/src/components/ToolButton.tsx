import clsx from "clsx";
import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

import { Icon, IconName } from "../icons";

import styles from "./ToolButton.module.css";

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string | ReactNode;
  classes?: string;
  icon?: IconName;
  latched?: boolean;
  subtle?: boolean;
  /** Visually hide the label (icon only) at narrow viewport widths. */
  collapseLabel?: boolean;
}

export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(
  (
    {
      label,
      classes = "",
      icon,
      className,
      latched,
      subtle,
      collapseLabel,
      title,
      ...rest
    },
    ref
  ) => {
    // Combine class names, ensuring default classes are applied first

    return (
      <button
        ref={ref}
        type="button"
        className={clsx(
          "btn",
          "btn-tools",
          styles.toolButton,
          classes,
          className,
          latched ? styles.latched : undefined,
          subtle ? styles.subtle : undefined
        )}
        title={title ?? (collapseLabel ? labelTitle(label) : undefined)}
        {...rest}
      >
        {icon && (
          <Icon
            name={icon}
            className={label && !collapseLabel ? styles.marginRight : undefined}
          />
        )}
        {collapseLabel && label ? (
          <span className={styles.collapsibleLabel}>{label}</span>
        ) : (
          label
        )}
      </button>
    );
  }
);

// A collapsed label is invisible, so it doubles as the tooltip.
const labelTitle = (label: ToolButtonProps["label"]) =>
  typeof label === "string" ? label : undefined;

// Add display name for debugging purposes
ToolButton.displayName = "ToolButton";
