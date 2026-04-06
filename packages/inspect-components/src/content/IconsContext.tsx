import { createContext, useContext } from "react";

/**
 * Subset of ApplicationIcons used by content components.
 * Each app provides its own icon class names via this context.
 */
export interface ContentIcons {
  model: string;
  search: string;
  tree: {
    open: string;
    closed: string;
  };
}

const defaultIcons: ContentIcons = {
  model: "bi bi-grid-3x3-gap",
  search: "bi bi-search",
  tree: {
    open: "bi bi-caret-down-fill",
    closed: "bi bi-caret-right-fill",
  },
};

export const IconsContext = createContext<ContentIcons>(defaultIcons);

export const useContentIcons = (): ContentIcons => {
  return useContext(IconsContext);
};
