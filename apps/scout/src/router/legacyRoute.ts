import { isRecord, type WebviewStorage } from "@tsmono/util";

import { scanResultRoute, scanRoute } from "./url";

/** Read old webview snapshots once; current navigation never reads UI selection. */
export function readLegacyRoute(
  storage: WebviewStorage | undefined,
  scansDir: string
): string | undefined {
  const raw = storage?.getItem("inspect-scout-storage");
  if (!raw) return undefined;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || !isRecord(saved.state)) return undefined;
    const state = saved.state;
    if (
      typeof state.selectedScanLocation !== "string" ||
      !state.selectedScanLocation
    )
      return undefined;
    const dir =
      typeof state.userScansDir === "string" && state.userScansDir
        ? state.userScansDir
        : scansDir;
    if (!dir) return undefined;
    return typeof state.displayedScanResult === "string" &&
      state.displayedScanResult
      ? scanResultRoute(
          dir,
          state.selectedScanLocation,
          state.displayedScanResult
        )
      : scanRoute(dir, state.selectedScanLocation);
  } catch {
    return undefined;
  }
}
