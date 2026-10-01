import { createContext, useContext } from "react";

import {
  isRichContentPolicy,
  useContentPolicy,
} from "@tsmono/react/components";

export type DisplayMode = "rendered" | "raw";

export interface DisplayModeContextType {
  displayMode: DisplayMode;
}

export const DisplayModeContext = createContext<DisplayModeContextType | null>(
  null
);

/**
 * Hook to access display mode. Returns default "rendered" if no provider
 * exists. Rendering permission is resolved independently.
 */
export const useDisplayMode = (): DisplayMode => {
  const context = useContext(DisplayModeContext);
  // Graceful fallback: if no provider, default to "rendered"
  return context?.displayMode ?? "rendered";
};

/**
 * Whether log data may get specialized formatting (parsing, reshaping,
 * custom views). Surfaces the Raw preference never applied to use this.
 */
export const useFormattedData = (): boolean => useContentPolicy().formattedData;

export const useFormattedContent = (): boolean => {
  const policy = useContentPolicy();
  return useDisplayMode() === "rendered" && policy.formattedData;
};

// Arbitrary application callbacks may emit any rich content. Until they
// adopt the policy-aware rendering components, they require every permission.
export const useCustomContent = (): boolean => {
  const policy = useContentPolicy();
  return useDisplayMode() === "rendered" && isRichContentPolicy(policy);
};
