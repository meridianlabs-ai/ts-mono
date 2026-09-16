import { createHashRouter } from "react-router";

import type { WebviewStorage } from "@tsmono/util";

interface RouteRestoration {
  storage?: WebviewStorage;
  key: string;
  initialPath?: string;
  legacyPath?: string;
}

const isAppPath = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//");

/** Restore before creating the router; checkpoint committed locations outside React. */
export function createRestorableHashRouter(
  routes: Parameters<typeof createHashRouter>[0],
  { storage, key, initialPath, legacyPath }: RouteRestoration,
  options?: Parameters<typeof createHashRouter>[1]
): ReturnType<typeof createHashRouter> {
  const target = options?.window ?? window;
  const saved = storage?.getItem(key);
  const restored = isAppPath(saved)
    ? saved
    : isAppPath(legacyPath)
      ? legacyPath
      : initialPath;

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
