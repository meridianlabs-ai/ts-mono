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

  // Once either chevron is a link, both stay <a> for the component's life:
  // swapping a focused <a> for a <div> when it disables (e.g. Next on the last
  // sample) would remount it and drop keyboard focus to <body>.
  const linkMode = inAppHref(previousHref ?? nextHref) !== undefined;

  return (
    <div className={styles.container}>
      <Chevron
        icon={baseApplicationIcons.previous}
        action={onPrevious}
        enabled={hasPrevious}
        href={previousHref}
        linkMode={linkMode}
        label={previousLabel ?? previousTitle ?? "Previous"}
        title={previousTitle && `${previousTitle} (←)`}
      />
      {children && <div className={styles.center}>{children}</div>}
      <Chevron
        icon={baseApplicationIcons.next}
        action={onNext}
        enabled={hasNext}
        href={nextHref}
        linkMode={linkMode}
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
  linkMode: boolean;
  label: string;
  title: string | undefined;
}

/** One prev/next control: a link (a disabled link when there's nowhere to
 *  go) in link mode, otherwise a focusable div. */
const Chevron: FC<ChevronProps> = ({
  icon,
  action,
  enabled,
  href,
  linkMode,
  label,
  title,
}) => {
  if (linkMode) {
    const linkHref = enabled ? inAppHref(href) : undefined;
    const live = linkHref !== undefined && action !== undefined;
    return (
      <a
        href={live ? linkHref : undefined}
        // Without an href an <a> has no role; this is the disabled-link
        // pattern, focusable only so a focused chevron keeps focus.
        role={live ? undefined : "link"}
        aria-disabled={live ? undefined : true}
        tabIndex={live ? undefined : -1}
        onClick={live ? inAppLinkClick(action) : undefined}
        onKeyDown={(e) => {
          // Links activate on Enter natively; the chevrons also take Space.
          if (live && e.key === " ") {
            e.preventDefault();
            action();
          }
        }}
        aria-label={label}
        className={clsx(styles.nav, !live && styles.disabled)}
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
