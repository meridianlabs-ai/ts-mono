import { queryClient } from "../state/queryClient";

import { peekAppConfig, setResolvedLogDir } from "./appConfig";
import { APP_CONFIG_KEY, useAppConfig } from "./useAppConfig";

/**
 * Update the resolved log dir — embedded (VS Code) live navigation, the one
 * place logDir changes after resolution. Updates the config singleton (source of
 * truth) and mirrors it into the react-query cache so `useAppConfig` re-renders.
 */
export const setLogRoot = (logDir: string, absLogDir?: string): void => {
  const updated = setResolvedLogDir(logDir, absLogDir);
  queryClient.setQueryData(APP_CONFIG_KEY, updated);
};

/** The current log directory (resolved below the gate, both modes). */
export const useLogDir = (): string => useAppConfig().logDir;

/** The absolute log directory (dir mode only; single-file leaves it unset). */
export const useAbsLogDir = (): string | undefined => useAppConfig().absLogDir;

/** Non-React accessor for slice / routing code (undefined until resolved). */
export const getLogDir = (): string | undefined => peekAppConfig()?.logDir;

export const getAbsLogDir = (): string | undefined =>
  peekAppConfig()?.absLogDir;
