import type {
  Result,
  SearchInputListResponse,
  SearchRequest,
  SearchResponse,
} from "@tsmono/inspect-common/types";

import type { StoredSearchPanelState } from "./searchPanelState";

export type SearchScope = "events" | "messages";
export type SearchType = "grep" | "llm";

export type SearchResultScope = { events?: "all"; messages?: "all" };

/**
 * Backend seam for the SearchPanel. Each host (Scout, Inspect, ...) wraps its
 * own HTTP client to satisfy this contract. `cacheKey` is an opaque identifier
 * for the transcript scope — used inside the panel's React Query keys to keep
 * caches segmented per transcript without exposing transcriptDir/transcriptId
 * to the component.
 */
export interface SearchPanelApi {
  cacheKey: string;
  createSearch: (request: SearchRequest) => Promise<SearchResponse>;
  getCachedResult: (
    searchId: string,
    scope: SearchResultScope
  ) => Promise<Result | null>;
  listRecentSearches: (
    searchType: SearchType,
    count?: number
  ) => Promise<SearchInputListResponse>;
}

export interface SearchPanelStateController {
  state: StoredSearchPanelState | undefined;
  setState: (
    updater: (
      prev: StoredSearchPanelState | undefined
    ) => StoredSearchPanelState
  ) => void;
}

export interface ModelHistoryController {
  history: string[];
  record: (model: string) => void;
}

export interface SearchPanelNavigation {
  getMessageUrl: (id: string) => string | undefined;
  getEventUrl: (id: string) => string | undefined;
  getEventMessageUrl: (id: string) => string | undefined;
}
