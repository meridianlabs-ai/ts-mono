import clsx from "clsx";
import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

import { Button } from "./Button";
import styles from "./ToolButton.module.css";

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string | ReactNode;
  classes?: string;
  icon?: string;
  latched?: boolean;
  subtle?: boolean;
}

export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(
  ({ label, classes = "", icon, className, latched, subtle, ...rest }, ref) => {
    // Combine class names, ensuring default classes are applied first

    return (
      <Button
        ref={ref}
        variant="tool"
        className={clsx(
          styles.toolButton,
          classes,
          className,
          latched ? styles.latched : undefined,
          subtle ? styles.subtle : undefined
        )}
        {...rest}
      >
        {icon && (
          <i className={clsx(icon, label ? styles.marginRight : undefined)} />
        )}
        {label}
      </Button>
    );
  }
);

// Add display name for debugging purposes
ToolButton.displayName = "ToolButton";
