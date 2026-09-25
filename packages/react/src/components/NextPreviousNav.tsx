import clsx from "clsx";
import { FC, ReactNode } from "react";

import { useArrowStepper } from "../hooks/useArrowStepper";
import { baseApplicationIcons } from "../icons";

import { inAppHref, inAppLinkClick } from "./inAppLink";
import styles from "./NextPreviousNav.module.css";

interface NextPreviousNavProps {
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  children?: ReactNode;
  /** Tooltip for the previous button — the "(←)" shortcut suffix is appended
   *  here, next to the ArrowLeft binding, so the tooltip can never advertise
   *  an unwired shortcut. Also the aria-label (suffix-free) unless
   *  `previousLabel` overrides it. */
  previousTitle?: string;
  /** Tooltip for the next button. */
  nextTitle?: string;
  /** Accessible name for the previous button (defaults to `previousTitle`,
   *  then "Previous"). */
  previousLabel?: string;
  /** Accessible name for the next button. */
  nextLabel?: string;
  /** URLs of the previous/next items. When set, the enabled chevrons render
   *  as links so cmd/ctrl/middle-click open that item in a new tab; the
   *  `onPrevious`/`onNext` handlers still run for plain clicks and arrows. */
  previousHref?: string;
  nextHref?: string;
}

/**
 * Prev/next chevron pair with an optional center slot, wired to the
 * ArrowLeft/ArrowRight stepper (see useArrowStepper). Shared by scout's
 * transcript/scanner-result navs and inspect's sample navbar so the
 * keyboard binding, tooltips, and accessibility contract cannot drift.
 */
export const NextPreviousNav: FC<NextPreviousNavProps> = ({
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  children,
  previousTitle,
  nextTitle,
  previousLabel,
  nextLabel,
  previousHref,
  nextHref,
}) => {
  useArrowStepper({
    onPrev: onPrevious,
    onNext,
    canPrev: hasPrevious,
    canNext: hasNext,
  });

  return (
    <div className={styles.container}>
      <Chevron
        icon={baseApplicationIcons.previous}
        action={onPrevious}
        enabled={hasPrevious}
        href={previousHref}
        label={previousLabel ?? previousTitle ?? "Previous"}
        title={previousTitle && `${previousTitle} (←)`}
      />
      {children && <div className={styles.center}>{children}</div>}
      <Chevron
        icon={baseApplicationIcons.next}
        action={onNext}
        enabled={hasNext}
        href={nextHref}
        label={nextLabel ?? nextTitle ?? "Next"}
        title={nextTitle && `${nextTitle} (→)`}
      />
    </div>
  );
};

interface ChevronProps {
  icon: string;
  action: (() => void) | undefined;
  enabled: boolean;
  href: string | undefined;
  label: string;
  title: string | undefined;
}

/** One prev/next control: a link when it has somewhere to go, otherwise a
 *  focusable div. */
const Chevron: FC<ChevronProps> = ({
  icon,
  action,
  enabled,
  href,
  label,
  title,
}) => {
  const linkHref = enabled && action ? inAppHref(href) : undefined;
  if (linkHref && action) {
    return (
      <a
        href={linkHref}
        onClick={inAppLinkClick(action)}
        onKeyDown={(e) => {
          // Links activate on Enter natively; the chevrons also take Space.
          if (e.key === " ") {
            e.preventDefault();
            action();
          }
        }}
        aria-label={label}
        className={styles.nav}
        title={title}
      >
        <i className={icon} />
      </a>
    );
  }
  return (
    <div
      onClick={enabled ? action : undefined}
      // A focusable div (not <button>), so it needs its own Enter/Space
      // handler to be operable by keyboard.
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && enabled && action) {
          e.preventDefault();
          action();
        }
      }}
      tabIndex={enabled ? 0 : -1}
      role="button"
      aria-label={label}
      aria-disabled={!enabled}
      className={clsx(styles.nav, !enabled && styles.disabled)}
      title={title}
    >
      <i className={icon} />
    </div>
  );
};
