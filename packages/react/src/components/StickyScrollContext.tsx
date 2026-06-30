import { createContext, useContext } from "react";

/**
 * `stickyTop`: the vertical offset in px where sticky event-panel headers pin
 * (the height of the chrome above the scroll area). Provided per scroll surface
 * so a panel deep in the tree can read it without prop-drilling.
 */
export interface StickyScrollValue {
  stickyTop: number;
}

const StickyScrollContext = createContext<StickyScrollValue>({ stickyTop: 0 });

export const StickyScrollProvider = StickyScrollContext.Provider;

export const useStickyScroll = (): StickyScrollValue =>
  useContext(StickyScrollContext);
