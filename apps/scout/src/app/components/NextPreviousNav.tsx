import clsx from "clsx";
import { FC, ReactNode, useCallback } from "react";

import { useArrowStepper } from "@tsmono/react/hooks";

import { ApplicationIcons } from "../../icons";

import styles from "./NextPreviousNav.module.css";

interface NextPreviousNavProps {
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  children?: ReactNode;
  /** Tooltip for the previous button — the "(←)" shortcut suffix is appended
   *  here, next to the ArrowLeft binding, so the tooltip can never advertise
   *  an unwired shortcut. */
  previousTitle?: string;
  /** Tooltip for the next button. */
  nextTitle?: string;
}

export const NextPreviousNav: FC<NextPreviousNavProps> = ({
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  children,
  previousTitle,
  nextTitle,
}) => {
  useArrowStepper({
    onPrev: onPrevious,
    onNext,
    canPrev: hasPrevious,
    canNext: hasNext,
  });

  // These controls are focusable divs (not <button>), so a focused control
  // needs its own Enter/Space handler to be operable by keyboard.
  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      action: (() => void) | undefined,
      enabled: boolean
    ) => {
      if ((e.key === "Enter" || e.key === " ") && enabled && action) {
        e.preventDefault();
        action();
      }
    },
    []
  );

  return (
    <div className={styles.container}>
      <div
        onClick={hasPrevious ? onPrevious : undefined}
        onKeyDown={(e) => handleKeyDown(e, onPrevious, hasPrevious)}
        tabIndex={hasPrevious ? 0 : undefined}
        role="button"
        aria-disabled={!hasPrevious}
        className={clsx(styles.nav, !hasPrevious && styles.disabled)}
        title={previousTitle && `${previousTitle} (←)`}
      >
        <i className={ApplicationIcons.previous} />
      </div>
      {children && <div className={styles.center}>{children}</div>}
      <div
        onClick={hasNext ? onNext : undefined}
        onKeyDown={(e) => handleKeyDown(e, onNext, hasNext)}
        tabIndex={hasNext ? 0 : undefined}
        role="button"
        aria-disabled={!hasNext}
        className={clsx(styles.nav, !hasNext && styles.disabled)}
        title={nextTitle && `${nextTitle} (→)`}
      >
        <i className={ApplicationIcons.next} />
      </div>
    </div>
  );
};
