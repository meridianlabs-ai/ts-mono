import clsx from "clsx";
import {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { ModelEvent } from "@tsmono/inspect-common/types";
import { formatTime } from "@tsmono/util";

import { attemptDurationSec } from "./attemptDuration";
import styles from "./RetryChip.module.css";
import { summarizeModelError } from "./summarizeModelError";

interface RetryChipProps {
  attempts: ModelEvent[];
  selectedKey: string;
  onSelect: (key: string) => void;
  keyOf: (event: ModelEvent) => string;
}

const MENU_MIN_WIDTH = 280;

export const RetryChip: FC<RetryChipProps> = ({
  attempts,
  selectedKey,
  onSelect,
  keyOf,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // The chip lives inside the event panel header's title cell, which clips
  // its overflow (single-line ellipsis truncation) — so the menu is rendered
  // in a portal, fixed-positioned from the chip's rect, like EventNavsPicker.
  const computePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 4,
      left: Math.max(
        8,
        Math.min(rect.left, window.innerWidth - MENU_MIN_WIDTH - 8)
      ),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) computePosition();
  }, [open, computePosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const reposition = () => computePosition();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, computePosition]);

  if (attempts.length <= 1) return null;

  const priorCount = attempts.length - 1;
  const selectedIndex = attempts.findIndex((a) => keyOf(a) === selectedKey);
  const isCurrentSelected =
    selectedIndex === -1 || selectedIndex === attempts.length - 1;

  const chipText = isCurrentSelected
    ? priorCount === 1
      ? "1 prior retry"
      : `${priorCount} prior retries`
    : `attempt ${selectedIndex + 1} · ${summarizeModelError(attempts[selectedIndex]?.error)}`;

  const handleSelect = (key: string) => {
    setOpen(false);
    onSelect(key);
  };

  return (
    <span className={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={clsx(styles.chip, open && styles.chipOpen)}
        title={`${chipText} — click to view`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i
          className={clsx("bi", "bi-arrow-repeat", styles.chipIcon)}
          aria-hidden="true"
        />
        <span className={styles.chipText}>{chipText}</span>
        <i
          className={clsx("bi", "bi-chevron-down", styles.chipChevron)}
          aria-hidden="true"
        />
      </button>
      {open &&
        position &&
        createPortal(
          <>
            {/* Mouse-only dismissal; Escape closes the menu. */}
            <div
              className={styles.backdrop}
              role="presentation"
              onClick={() => setOpen(false)}
            />
            <div
              className={styles.menu}
              style={{ top: position.top, left: position.left }}
            >
              {attempts.map((attempt, idx) => {
                const key = keyOf(attempt);
                const isCurrent = idx === attempts.length - 1;
                const label = isCurrent
                  ? `Attempt ${idx + 1} · current`
                  : `Attempt ${idx + 1} · ${summarizeModelError(attempt.error)}`;
                const duration = formatAttemptDuration(attempt);
                return (
                  <button
                    key={key}
                    type="button"
                    className={clsx(
                      styles.item,
                      selectedKey === key && styles.itemActive
                    )}
                    onClick={() => handleSelect(key)}
                  >
                    <span className={styles.itemNum}>{idx + 1}</span>
                    <span className={styles.itemLabel}>{label}</span>
                    {duration && (
                      <span className={styles.itemStatus}>{duration}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </span>
  );
};

function formatAttemptDuration(event: ModelEvent): string | null {
  const sec = attemptDurationSec(event);
  return sec != null ? formatTime(sec) : null;
}
