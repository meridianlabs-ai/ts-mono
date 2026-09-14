import { useParams } from "react-router";

import { useMirrorToStore } from "@tsmono/react/hooks";
import { join } from "@tsmono/util";

import { useAppConfig } from "../app/server/useAppConfig";
import { useStore } from "../state/store";

import { parseScanParams } from "./url";

/**
 * The scan route's params, with `scansDir` resolved against the server's
 * configured directory. The last route directory seen is mirrored into the
 * store so it stays the user's directory after navigating to a route without
 * the param (see `useScansDir`).
 */
export const useScanRoute = (): {
  scansDir?: string;
  relativePath: string;
  scanPath: string;
  scanResultUuid?: string;
  resolvedScansDir?: string;
  location?: string;
} => {
  const params = useParams<{ scansDir?: string; "*": string }>();
  const setUserScansDir = useStore((state) => state.setUserScansDir);
  const config = useAppConfig();
  const scansDir = config.scans.dir;

  const route = parseScanParams(params);
  const resolvedScansDir = route.scansDir || scansDir;
  const location = resolvedScansDir
    ? join(route.scanPath, resolvedScansDir)
    : undefined;

  useMirrorToStore(route.scansDir, setUserScansDir);

  return {
    ...route,
    resolvedScansDir,
    location,
  };
};
