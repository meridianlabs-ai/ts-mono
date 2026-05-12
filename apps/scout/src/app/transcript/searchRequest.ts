import type { SearchRequest } from "../../types/api-types";

export type SearchType = "grep" | "llm";
export type TranscriptSearchScope = "events" | "messages";

export type GrepOptions = {
  ignoreCase: boolean;
  regex: boolean;
  wordBoundary: boolean;
};

type BuildSearchRequestOptions = {
  grepOptions: GrepOptions;
  model: string;
  query: string;
  scope: TranscriptSearchScope;
  searchType: SearchType;
};

export type SearchScopeFields = {
  events?: "all";
  messages?: "all";
};

export const buildSearchScope = (
  scope: TranscriptSearchScope
): SearchScopeFields => {
  return scope === "messages" ? { messages: "all" } : { events: "all" };
};

export const buildSearchRequest = ({
  grepOptions,
  model,
  query,
  scope,
  searchType,
}: BuildSearchRequestOptions): SearchRequest => {
  const scopeFields = buildSearchScope(scope);

  if (searchType === "grep") {
    return {
      ...scopeFields,
      ignore_case: grepOptions.ignoreCase,
      query,
      regex: grepOptions.regex,
      type: "grep",
      word_boundary: grepOptions.wordBoundary,
    };
  }

  return {
    ...scopeFields,
    model: model || null,
    query,
    type: "llm",
  };
};
