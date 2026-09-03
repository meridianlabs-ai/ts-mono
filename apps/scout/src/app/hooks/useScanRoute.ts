import { useEffect, useMemo } from "react";
import { useParams } from "react-router";

import { join } from "@tsmono/util";

import { parseScanParams } from "../../router/url";
import { useStore } from "../../state/store";
import { useAppConfig } from "../server/useAppConfig";

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

  const route = useMemo(() => parseScanParams(params), [params]);
  const resolvedScansDir = route.scansDir || scansDir;
  const location = resolvedScansDir
    ? join(route.scanPath, resolvedScansDir)
    : undefined;

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (route.scansDir) {
      setUserScansDir(route.scansDir);
    }
  }, [route.scansDir, setUserScansDir]);

  return {
    ...route,
    resolvedScansDir,
    location,
  };
};
