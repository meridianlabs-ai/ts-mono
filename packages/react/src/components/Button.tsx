import clsx from "clsx";
import { ButtonHTMLAttributes, forwardRef } from "react";

import styles from "./Button.module.css";

export type ButtonVariant =
  | "default"
  | "primary"
  | "secondary"
  | "outline-primary"
  | "tool";

const variantClass: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: styles.primary,
  secondary: styles.secondary,
  "outline-primary": styles.outlinePrimary,
  tool: styles.tool,
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/**
 * The shared button primitive. Variants cover the visual treatments the
 * viewers use; one-off layout/sizing belongs in the caller's `className`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", className, type = "button", ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={clsx(styles.button, variantClass[variant], className)}
      {...rest}
    />
  )
);

Button.displayName = "Button";
