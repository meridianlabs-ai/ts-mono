import { createContext, useContext } from "react";

import { useContentTrust } from "@tsmono/react/components";

export type DisplayMode = "rendered" | "raw";

export interface DisplayModeContextType {
  displayMode: DisplayMode;
}

export const DisplayModeContext = createContext<DisplayModeContextType | null>(
  null
);

/**
 * Hook to access display mode. Returns default "rendered" if no provider
 * exists, and always "raw" for content that isn't trusted.
 */
export const useDisplayMode = (): DisplayMode => {
  const context = useContext(DisplayModeContext);
  const trust = useContentTrust();
  if (trust !== "trusted") {
    return "raw";
  }
  // Graceful fallback: if no provider, default to "rendered"
  return context?.displayMode ?? "rendered";
};
