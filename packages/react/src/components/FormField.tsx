import clsx from "clsx";
import {
  forwardRef,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import styles from "./FormField.module.css";

/** Single-line text field. */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...rest }, ref) => (
  <input ref={ref} className={clsx(styles.input, className)} {...rest} />
));
Input.displayName = "Input";

/** Multi-line text field sharing the Input treatment. */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...rest }, ref) => (
  <textarea ref={ref} className={clsx(styles.input, className)} {...rest} />
));
TextArea.displayName = "TextArea";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** "sm" is the compact toolbar density. */
  fieldSize?: "default" | "sm";
}

/** Native select with the shared field treatment. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, fieldSize = "default", ...rest }, ref) => (
    <select
      ref={ref}
      className={clsx(
        styles.select,
        fieldSize === "sm" && styles.selectSm,
        className
      )}
      {...rest}
    />
  )
);
Select.displayName = "Select";
