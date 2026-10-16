import { createHashRouter } from "react-router";

import type { WebviewStorage } from "@tsmono/util";

interface RouteRestoration {
  storage?: WebviewStorage;
  key: string;
  initialPath?: string;
}

const isAppPath = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//");

/** Restore before creating the router; checkpoint committed locations outside React. */
export function createRestorableHashRouter(
  routes: Parameters<typeof createHashRouter>[0],
  { storage, key, initialPath }: RouteRestoration,
  options?: Parameters<typeof createHashRouter>[1]
): ReturnType<typeof createHashRouter> {
  const target = options?.window ?? window;
  const saved = storage?.getItem(key);
  const restored = isAppPath(saved) ? saved : initialPath;

  // An explicit URL always wins. An empty webview starts from its checkpoint
  // (or host launch destination), before any route-dependent view can mount.
  if (!target.location.hash && isAppPath(restored)) {
    target.history.replaceState(target.history.state, "", `#${restored}`);
  }

  const router = createHashRouter(routes, options);
  if (storage) {
    let previous: string | undefined;
    const save = () => {
      const { pathname, search, hash } = router.state.location;
      const path = pathname + search + hash;
      if (path !== previous) {
        storage.setItem(key, path);
        previous = path;
      }
    };
    save();
    // Router disposal clears subscriptions. No effect/mount ordering or
    // debounce timer stands between navigation and the host checkpoint.
    router.subscribe(save);
  }
  return router;
}

/**
 * Absolute URL for a hash route. Keeps the host page's path and query
 * (e.g. `?log_dir=`, `?mode=scans`), which the app reads at startup.
 */
export const hashRouteUrl = (route: string): string => {
  const path = route.startsWith("#") ? route.slice(1) : route;
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#${path}`;
};

/**
 * Opens an href in a new tab without `window.opener` or a referrer, then
 * refocuses this window.
 *
 * Where there is a link to render, prefer an `<a href>` so the browser handles
 * cmd/ctrl/middle-click natively.
 */
export function openHrefInNewTab(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
  window.focus();
}

/** Opens a hash route in a new tab (see `openHrefInNewTab`). */
export function openRouteInNewTab(route: string): void {
  openHrefInNewTab(hashRouteUrl(route));
}
