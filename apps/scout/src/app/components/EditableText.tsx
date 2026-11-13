import clsx from "clsx";
import { FC, useRef } from "react";

import { Icon, IconName } from "@tsmono/react/icons";

import styles from "./EditableText.module.css";

interface EditableTextProps {
  value?: string;
  secondaryValue?: string | null;
  onValueChanged: (value: string) => void;

  label?: string;
  title?: string;

  icon?: IconName;
  placeholder?: string;

  editable?: boolean;

  className?: string;
}

export const EditableText: FC<EditableTextProps> = ({
  value,
  secondaryValue,
  onValueChanged,
  icon,
  label,
  title,
  placeholder,
  editable = true,
  className,
}) => {
  const spanRef = useRef<HTMLSpanElement>(null);
  const initialValueRef = useRef<string>("");

  const handleFocus = () => {
    if (spanRef.current) {
      initialValueRef.current = spanRef.current.textContent || "";

      // Select all text on focus
      const range = document.createRange();
      range.selectNodeContents(spanRef.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const handleBlur = () => {
    if (spanRef.current) {
      const newValue = spanRef.current.textContent.trim() || "";
      if (newValue !== "" && newValue !== initialValueRef.current) {
        onValueChanged(newValue);
      } else if (newValue === "") {
        // Restore the original value if empty
        spanRef.current.textContent = initialValueRef.current;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      spanRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Restore original value on escape
      if (spanRef.current) {
        spanRef.current.textContent = initialValueRef.current;
      }
      spanRef.current?.blur();
    }
  };

  const displayValue = value || placeholder || "";

  return (
    <div className={clsx(styles.container, className)}>
      <div className={clsx(styles.labelContainer)} title={title}>
        {icon && <Icon name={icon} className={styles.icon} />}
        {label}
      </div>
      <span
        ref={spanRef}
        contentEditable={editable}
        role="textbox"
        tabIndex={0}
        aria-multiline="false"
        aria-readonly={!editable}
        aria-label={label ?? title}
        className={clsx(
          styles.text,
          !value ? styles.placeholder : "",
          !editable ? styles.readOnly : ""
        )}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        suppressContentEditableWarning
      >
        {displayValue}
      </span>
      {secondaryValue && (
        <span
          className={clsx(
            styles.text,
            styles.placeholder,
            styles.secondary,
            !editable ? styles.readOnly : ""
          )}
        >
          {secondaryValue}
        </span>
      )}
    </div>
  );
};
