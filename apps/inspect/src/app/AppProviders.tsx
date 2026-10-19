import { FC, ReactNode } from "react";

import { ComponentStateProvider } from "@tsmono/react/state";

import { inspectStateHooks } from "../state/componentStateAdapter";

/**
 * The component-level context every inspect view renders under: component
 * state backed by the store. The app and the test harness
 * (`src/test/testApp.tsx`) both render this, so tests see the same context.
 */
export const AppProviders: FC<{ children: ReactNode }> = ({ children }) => (
  <ComponentStateProvider hooks={inspectStateHooks}>
    {children}
  </ComponentStateProvider>
);
