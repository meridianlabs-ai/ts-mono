import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { ReactNode } from "react";

import { APP_CONFIG_KEY, AppConfig, initAppConfig } from "../../../app_config";
import { testClientAPI } from "../../../client/api/testClientApi";
import { ClientAPI } from "../../../client/api/types";

/**
 * Renders an edit dialog against a stub ClientAPI. `dialog` receives
 * `showing` so `reopen()` can close and reopen it.
 */
export const renderEditDialog = (
  api: Partial<ClientAPI>,
  dialog: (showing: boolean) => ReactNode
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const config: AppConfig = {
    api: testClientAPI(api),
    singleFileMode: false,
    loader: "replicator",
    inspect_version: "1.0.0",
    scout_version: null,
    logDir: "/logs",
    absLogDir: "/abs/logs",
  };
  initAppConfig(config);
  client.setQueryData(APP_CONFIG_KEY, config);
  const wrap = (showing: boolean) => (
    <QueryClientProvider client={client}>{dialog(showing)}</QueryClientProvider>
  );
  const view = render(wrap(true));
  return {
    client,
    reopen: () => {
      view.rerender(wrap(false));
      view.rerender(wrap(true));
    },
  };
};
