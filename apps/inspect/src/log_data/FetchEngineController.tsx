import { FC, useEffect } from "react";

import { useAppConfig } from "../app_config";

import {
  activateFetchEngine,
  deactivateFetchEngine,
} from "./replicationControl";

/**
 * Owns the fetch engine's lifetime — a render-null controller mounted once,
 * directly below the config gate. Starts the engine from the resolved config
 * snapshot and, when the config changes (a VS Code dir switch rebuilds it:
 * new api + new logDir together), restarts the engine and re-points the
 * per-dir database from the new snapshot. Acquisition paths (`syncLogs`,
 * `fetchLog`) never activate; they await the engine being ready for their
 * dir.
 */
export const FetchEngineController: FC = () => {
  const config = useAppConfig();
  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    activateFetchEngine(config);
    return () => deactivateFetchEngine();
  }, [config]);
  return null;
};
