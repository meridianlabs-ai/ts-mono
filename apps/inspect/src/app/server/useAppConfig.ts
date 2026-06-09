import { AppConfig } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";

/**
 * Loads app config (installed inspect / scout versions) asynchronously at app
 * initialization.
 *
 * Use this hook only at the top of the app before rendering to load config
 * data globally. After it completes, all other components should use
 * useAppConfig to access the loaded value synchronously.
 */
export const useAppConfigAsync = (): AsyncData<AppConfig> => {
  const api = useApi();

  return useAsyncDataFromQuery({
    queryKey: ["app-config"],
    queryFn: () => api.get_app_config(),
    staleTime: Infinity,
  });
};

/**
 * Returns app config for use in components after data loaded globally.
 *
 * Assumes the async data has already been loaded at app initialization via
 * useAppConfigAsync (App.tsx gates rendering on it). Throws if not yet loaded.
 */
export const useAppConfig = (): AppConfig => {
  const { data } = useAppConfigAsync();
  if (!data) throw new Error("App config not loaded");
  return data;
};
