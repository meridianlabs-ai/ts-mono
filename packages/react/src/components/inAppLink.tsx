import type { FC, MouseEvent, ReactNode } from "react";

import { isVscode } from "@tsmono/util";

/** The mouse-event fields that decide how a link click is handled. */
interface LinkClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * True for a click the browser turns into "open link in a new tab/window"
 * (cmd/ctrl/shift-click, middle-click). An in-app link leaves these to the
 * browser and handles the rest itself.
 */
export const isNewTabClick = (e: LinkClick): boolean =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;

/**
 * The href for a control that navigates in-app, or undefined where it should
 * stay a button: the VS Code webview has no browser tabs, so a link there only
 * reaches the host's own link handling.
 */
export const inAppHref = (href: string | undefined): string | undefined =>
  href === undefined || isVscode() ? undefined : href;

/**
 * `onClick` for an `<a href>` that also navigates in-app: a plain click
 * prevents the default and runs `navigate`; new-tab gestures are left to the
 * browser.
 */
export const inAppLinkClick =
  <E extends Element>(navigate: (e: MouseEvent<E>) => void) =>
  (e: MouseEvent<E>): void => {
    if (isNewTabClick(e)) return;
    e.preventDefault();
    navigate(e);
  };

interface InAppLinkProps {
  /** Destination URL. Without one (or inside VS Code) this renders a button. */
  href: string | undefined;
  /** The in-app navigation, run on plain clicks. */
  onNavigate: () => void;
  className?: string;
  title?: string;
  "aria-label"?: string;
  /** Keep clicks from also activating a clickable ancestor (e.g. a row). */
  stopPropagation?: boolean;
  children: ReactNode;
}

/**
 * A control that navigates in-app: a link, so the browser's new-tab gestures
 * work, where browser tabs exist; a button otherwise. Controls with their own
 * semantics (tabs, segments, prev/next) build on the helpers above instead.
 */
export const InAppLink: FC<InAppLinkProps> = ({
  href,
  onNavigate,
  className,
  title,
  "aria-label": ariaLabel,
  stopPropagation,
  children,
}) => {
  const linkHref = inAppHref(href);
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (stopPropagation) e.stopPropagation();
    if (linkHref) inAppLinkClick(onNavigate)(e);
    else onNavigate();
  };
  return linkHref ? (
    <a
      href={linkHref}
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </a>
  ) : (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
};
