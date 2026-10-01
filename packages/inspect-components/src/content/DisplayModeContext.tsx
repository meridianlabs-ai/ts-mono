import { createContext, useContext } from "react";

import { useHasAllContentPermissions } from "@tsmono/react/components";

export type DisplayMode = "rendered" | "raw";

export interface DisplayModeContextType {
  displayMode: DisplayMode;
}

export const DisplayModeContext = createContext<DisplayModeContextType | null>(
  null
);

/**
 * Hook to access display mode. Returns default "rendered" if no provider exists.
 */
export const useDisplayMode = (): DisplayMode => {
  const context = useContext(DisplayModeContext);
  // Graceful fallback: if no provider, default to "rendered"
  return context?.displayMode ?? "rendered";
};

/**
 * Whether arbitrary application renderers (custom tool views, content
 * renderers) may run: they can emit any rich content, so they need the
 * rendered display mode and every content permission.
 */
export const useCustomContent = (): boolean => {
  const trusted = useHasAllContentPermissions();
  return useDisplayMode() === "rendered" && trusted;
};
