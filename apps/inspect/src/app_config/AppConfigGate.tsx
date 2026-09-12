import { FC, ReactNode } from "react";

import { AsyncGate } from "@tsmono/react/components";

import { useAppConfigAsync } from "./hooks";
import { LogLocationGate } from "./LogLocationGate";

export const AppConfigGate: FC<{ children: ReactNode }> = ({ children }) => {
  const config = useAppConfigAsync();
  return (
    <AsyncGate
      async={config}
      errorLabel="Failed to load application configuration"
      loadingText="Loading application…"
    >
      {config.data ? (
        <LogLocationGate config={config.data}>{children}</LogLocationGate>
      ) : null}
    </AsyncGate>
  );
};
