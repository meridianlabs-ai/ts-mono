import { FC, ReactNode } from "react";

import { LogLoadController } from "./LogLoadController";
import { SampleLoadController } from "./SampleLoadController";

/** Applies per-view UI resets below the route-derived selection provider. */
export const LoaderMounts: FC<{ children: ReactNode }> = ({ children }) => (
  <>
    <LogLoadController />
    <SampleLoadController />
    {children}
  </>
);
