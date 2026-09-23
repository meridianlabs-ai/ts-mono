import { toFullUrl } from "../routing/url";

/**
 * Opens an href in a new background tab.
 * Blurs the new window and refocuses the current window
 * so the new tab doesn't steal focus.
 *
 * Only for paths with nothing to click (keyboard shortcuts); where there is,
 * render an `<a href={toFullUrl(route)}>` so the browser handles
 * cmd/ctrl/middle-click natively.
 */
export function openHrefInNewTab(href: string): void {
  const newWin = window.open(href, "_blank", "noopener,noreferrer");
  if (newWin) {
    newWin.blur();
  }
  window.focus();
}

/** Opens a hash-route URL in a new background tab (see `openHrefInNewTab`). */
export function openInNewTab(hashRoute: string): void {
  openHrefInNewTab(
    toFullUrl(hashRoute.startsWith("#") ? hashRoute.slice(1) : hashRoute)
  );
}
