import { SavedSearch } from "../../types/api-types";

import type {
  GrepOptions,
  SearchType,
  TranscriptSearchScope,
} from "./searchRequest";

export type SearchPanelState = {
  query: string;
  searchType: SearchType;
  hasSearched: boolean;
  currentSearch: SavedSearch | null;
  grepOptions: GrepOptions;
  model: string;
};

export const createInitialSearchPanelState = (): SearchPanelState => ({
  query: "",
  searchType: "llm",
  hasSearched: false,
  currentSearch: null,
  grepOptions: {
    ignoreCase: true,
    regex: false,
    wordBoundary: false,
  },
  model: "",
});

export const getSearchPanelStateKey = ({
  scope,
  transcriptDir,
  transcriptId,
}: {
  scope: TranscriptSearchScope;
  transcriptDir: string;
  transcriptId: string;
}) => `search-panel:${transcriptDir}:${transcriptId}:${scope}`;
