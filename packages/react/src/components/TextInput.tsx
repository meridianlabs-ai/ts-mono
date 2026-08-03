import clsx from "clsx";
import { ChangeEvent, FocusEvent, forwardRef } from "react";

import { useComponentIcons } from "./ComponentIconContext";
import styles from "./TextInput.module.css";

export interface TextInputProps {
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  icon?: string;
  placeholder?: string;
  className?: string | string[];
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ value, onChange, onFocus, icon, placeholder, className }, ref) => {
    const icons = useComponentIcons();

    return (
      <div
        className={clsx(
          styles.container,
          className,
          icon ? styles.withIcon : ""
        )}
      >
        {icon && <i className={clsx(icon, styles.icon)} aria-hidden="true" />}
        <input
          type="text"
          value={value}
          onChange={onChange}
          ref={ref}
          placeholder={placeholder}
          className={clsx(styles.input)}
          onFocus={onFocus}
        />
        <button
          type="button"
          className={clsx(
            styles.clearText,
            value === "" ? styles.hidden : "",
            icons.clearText
          )}
          onClick={() => {
            if (onChange && value !== "") {
              onChange({
                target: { value: "" },
              } as ChangeEvent<HTMLInputElement>);
            }
          }}
          disabled={value === ""}
          aria-label="Clear"
        />
      </div>
    );
  }
);

TextInput.displayName = "TextInput";
