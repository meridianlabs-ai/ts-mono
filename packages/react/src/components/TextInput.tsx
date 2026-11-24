import clsx from "clsx";
import { FocusEvent, forwardRef } from "react";

import { Icon, IconName } from "../icons";

import styles from "./TextInput.module.css";

/**
 * What TextInput hands `onChange`: the input's new value, either from a real
 * change event (which satisfies this) or from the clear button, which has no
 * event of its own.
 */
export interface TextInputChange {
  target: { value: string };
}

export interface TextInputProps {
  value?: string;
  onChange?: (event: TextInputChange) => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  icon?: IconName;
  placeholder?: string;
  className?: string | string[];
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ value, onChange, onFocus, icon, placeholder, className }, ref) => {
    return (
      <div
        className={clsx(
          styles.container,
          className,
          icon ? styles.withIcon : ""
        )}
      >
        {icon && <Icon name={icon} className={styles.icon} />}
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
          className={clsx(styles.clearText, value === "" ? styles.hidden : "")}
          onClick={() => {
            if (onChange && value !== "") {
              onChange({ target: { value: "" } });
            }
          }}
          disabled={value === ""}
          aria-label="Clear"
        >
          <Icon name="clearText" />
        </button>
      </div>
    );
  }
);

TextInput.displayName = "TextInput";
