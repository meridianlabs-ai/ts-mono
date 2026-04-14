import { SearchRequest } from "../../types/api-types";

export type SearchType = "grep" | "llm";
export type TranscriptSearchScope = "events" | "messages";

export type GrepOptions = {
  ignoreCase: boolean;
  regex: boolean;
  wordBoundary: boolean;
};

type BuildSearchRequestOptions = {
  defaultModel: string | null | undefined;
  grepOptions: GrepOptions;
  model: string;
  query: string;
  scope: TranscriptSearchScope;
  searchType: SearchType;
};

const getScopeFields = (scope: TranscriptSearchScope) => {
  return scope === "messages"
    ? { messages: "all" as const }
    : { events: "all" as const };
};

export const buildSearchRequest = ({
  defaultModel,
  grepOptions,
  model,
  query,
  scope,
  searchType,
}: BuildSearchRequestOptions): SearchRequest => {
  const scopeFields = getScopeFields(scope);

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
    model: model.trim() || defaultModel || null,
    query,
    type: "llm",
  };
};
