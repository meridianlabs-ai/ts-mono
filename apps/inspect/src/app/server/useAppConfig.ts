import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { AppConfig, resolveAppConfig } from "../appConfig";

export const APP_CONFIG_KEY = ["app-config"] as const;

/**
 * Resolves the full app config into the `["app-config"]` cache. The resolution
 * logic is framework-free (`resolveAppConfig`); this is the react-query glue.
 * It's the single thing the top-level gate watches; once it settles, the app
 * reads the value synchronously via `useAppConfig`.
 */
export const useAppConfigAsync = (): AsyncData<AppConfig> =>
  useAsyncDataFromQuery({
    queryKey: APP_CONFIG_KEY,
    queryFn: resolveAppConfig,
    staleTime: Infinity,
  });

/**
 * The resolved app config, read synchronously. The app renders below the gate
 * that awaits `useAppConfigAsync`, so the data is always present here; throws if
 * called above the gate.
 */
export const useAppConfig = (): AppConfig => {
  const { data } = useAppConfigAsync();
  if (!data) throw new Error("App config not loaded");
  return data;
};
