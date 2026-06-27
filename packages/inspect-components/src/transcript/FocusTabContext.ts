import { createContext } from "react";

export interface FocusTabValue {
  /** Currently selected tab NAME (e.g. "API"), remembered across events. */
  tab: string;
  setTab: (tab: string) => void;
}

/**
 * Set on the single-event focus page. When present, a multi-tab event panel
 * follows this shared tab (by name) instead of its own per-event selection, so
 * navigating between turns keeps the same tab open. Absent in the main
 * transcript (each panel remembers its own tab).
 */
export const FocusTabContext = createContext<FocusTabValue | null>(null);
