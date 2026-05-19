import clsx from "clsx";
import { FC, useEffect, useRef } from "react";

import styles from "./AutogrowText.module.css";

interface AutogrowTextProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  // Maximum height before the textarea starts scrolling internally.
  maxHeightPx?: number;
}

// A single-line-by-default textarea that grows with its content up to
// `maxHeightPx` (default 220) and then scrolls. Used by the metadata
// editor so that long JSON values stay visible without blowing out the
// dialog height.
export const AutogrowText: FC<AutogrowTextProps> = ({
  value,
  onChange,
  disabled,
  maxHeightPx = 220,
}) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`;
  }, [value, maxHeightPx]);

  return (
    <textarea
      ref={ref}
      className={clsx("form-control", styles.textarea)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      spellCheck={false}
      rows={1}
    />
  );
};
