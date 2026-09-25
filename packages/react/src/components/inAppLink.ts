import type { MouseEvent } from "react";

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
