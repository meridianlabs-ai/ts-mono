/**
 * Opens a hash-route URL in a new background tab.
 * Blurs the new window and refocuses the current window
 * so the new tab doesn't steal focus.
 */
export function openInNewTab(hashRoute: string): void {
  const newWin = window.open(
    `${window.location.pathname}#${hashRoute}`,
    "_blank"
  );
  if (newWin) {
    newWin.blur();
  }
  window.focus();
}
