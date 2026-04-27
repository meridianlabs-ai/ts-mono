import type { Result } from "../../types/api-types";

import type {
  GrepOptions,
  SearchType,
  TranscriptSearchScope,
} from "./searchRequest";

export type SearchTypePanelState = {
  query: string;
  hasSearched: boolean;
  currentSearch: Result | null;
};

export type GrepSearchPanelState = SearchTypePanelState & {
  grepOptions: GrepOptions;
};

export type LlmSearchPanelState = SearchTypePanelState & {
  model: string;
};

export type SearchPanelState = {
  searchType: SearchType;
  searches: {
    grep: GrepSearchPanelState;
    llm: LlmSearchPanelState;
  };
};

type StoredGrepSearchPanelState = Partial<
  Omit<GrepSearchPanelState, "grepOptions">
> & {
  grepOptions?: Partial<GrepOptions>;
};

export type StoredSearchPanelState = {
  searchType?: SearchType;
  searches?: {
    grep?: StoredGrepSearchPanelState;
    llm?: Partial<LlmSearchPanelState>;
  };
  query?: string;
  hasSearched?: boolean;
  currentSearch?: Result | null;
  grepOptions?: Partial<GrepOptions>;
  model?: string;
};

export const createInitialSearchPanelState = (): SearchPanelState => ({
  searchType: "llm",
  searches: {
    grep: {
      query: "",
      hasSearched: false,
      currentSearch: null,
      grepOptions: {
        ignoreCase: true,
        regex: false,
        wordBoundary: false,
      },
    },
    llm: {
      query: "",
      hasSearched: false,
      currentSearch: null,
      model: "",
    },
  },
});

const mergeGrepOptions = (options?: Partial<GrepOptions>): GrepOptions => ({
  ignoreCase: options?.ignoreCase ?? true,
  regex: options?.regex ?? false,
  wordBoundary: options?.wordBoundary ?? false,
});

export const normalizeSearchPanelState = (
  state?: StoredSearchPanelState
): SearchPanelState => {
  const initial = createInitialSearchPanelState();
  if (!state) {
    return initial;
  }

  const searchType = state.searchType ?? initial.searchType;
  if (state.searches) {
    return {
      searchType,
      searches: {
        grep: {
          ...initial.searches.grep,
          ...state.searches.grep,
          grepOptions: mergeGrepOptions(state.searches.grep?.grepOptions),
        },
        llm: {
          ...initial.searches.llm,
          ...state.searches.llm,
        },
      },
    };
  }

  if (searchType === "grep") {
    return {
      ...initial,
      searchType,
      searches: {
        ...initial.searches,
        grep: {
          query: state.query ?? "",
          hasSearched: state.hasSearched ?? false,
          currentSearch: state.currentSearch ?? null,
          grepOptions: mergeGrepOptions(state.grepOptions),
        },
      },
    };
  }

  return {
    ...initial,
    searchType,
    searches: {
      ...initial.searches,
      llm: {
        query: state.query ?? "",
        hasSearched: state.hasSearched ?? false,
        currentSearch: state.currentSearch ?? null,
        model: state.model ?? "",
      },
    },
  };
};

export const getSearchPanelStateKey = ({
  scope,
  transcriptDir,
  transcriptId,
}: {
  scope: TranscriptSearchScope;
  transcriptDir: string;
  transcriptId: string;
}) => `search-panel:${transcriptDir}:${transcriptId}:${scope}`;
