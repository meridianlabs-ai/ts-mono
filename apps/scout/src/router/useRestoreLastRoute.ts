import { useMountEffect } from "@tsmono/react/hooks";

import { useLoggingNavigate } from "../debugging/navigationDebugging";
import { useStore } from "../state/store";

import { scanResultRoute, scanRoute } from "./url";

const isDefaultRoute = (path: string): boolean =>
  path === "" || path === "/" || path === "/scans" || path === "/transcripts";

/**
 * On first load, when the app opened on a default route, replaces it with
 * the last scan (or scan result) the user was viewing, read from the
 * persisted store. Runs once per app lifetime: `hasInitializedRouting`
 * guards against re-running when the layout remounts (e.g. the router is
 * recreated on an app-config change).
 */
export const useRestoreLastRoute = (
  serverScansDir: string | undefined
): void => {
  const navigate = useLoggingNavigate("useRestoreLastRoute");
  const hasInitializedRouting = useStore(
    (state) => state.hasInitializedRouting
  );
  const setHasInitializedRouting = useStore(
    (state) => state.setHasInitializedRouting
  );
  const displayedScanResult = useStore((state) => state.displayedScanResult);
  const selectedScanLocation = useStore((state) => state.selectedScanLocation);
  const userScansDir = useStore((state) => state.userScansDir);

  // Mount-only by design: the redirect is decided from the values present at
  // first load, and anything that arrives later must not trigger it.
  useMountEffect(() => {
    if (hasInitializedRouting) {
      return;
    }

    // Read the live hash rather than useLocation(): an embedded-message
    // navigation (useWindowMessaging) may have just replaced the route in an
    // earlier effect of the same commit, and it must win over the restore.
    const currentPath = window.location.hash.slice(1);

    const resolvedScansDir = userScansDir || serverScansDir;
    if (
      isDefaultRoute(currentPath) &&
      selectedScanLocation &&
      resolvedScansDir
    ) {
      if (displayedScanResult) {
        navigate(
          scanResultRoute(
            resolvedScansDir,
            selectedScanLocation,
            displayedScanResult
          ),
          { replace: true }
        );
      } else {
        navigate(scanRoute(resolvedScansDir, selectedScanLocation), {
          replace: true,
        });
      }
    }

    setHasInitializedRouting(true);
  });
};
