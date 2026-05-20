import type { GrepOptions, SearchType } from "./searchRequest";

export type GrepSearchPanelState = {
  query: string;
  grepOptions: GrepOptions;
  searchId: string | null;
};

export type LlmSearchPanelState = {
  query: string;
  model: string;
  searchId: string | null;
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
};

export const createInitialSearchPanelState = (): SearchPanelState => ({
  searchType: "llm",
  searches: {
    grep: {
      query: "",
      searchId: null,
      grepOptions: {
        ignoreCase: true,
        regex: false,
        wordBoundary: false,
      },
    },
    llm: {
      query: "",
      searchId: null,
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
  if (!state) return initial;

  return {
    searchType: state.searchType ?? initial.searchType,
    searches: {
      grep: {
        query: state.searches?.grep?.query ?? initial.searches.grep.query,
        searchId:
          state.searches?.grep?.searchId ?? initial.searches.grep.searchId,
        grepOptions: mergeGrepOptions(state.searches?.grep?.grepOptions),
      },
      llm: {
        query: state.searches?.llm?.query ?? initial.searches.llm.query,
        model: state.searches?.llm?.model ?? initial.searches.llm.model,
        searchId:
          state.searches?.llm?.searchId ?? initial.searches.llm.searchId,
      },
    },
  };
};
