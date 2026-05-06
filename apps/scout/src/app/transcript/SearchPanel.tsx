import { useQueryClient } from "@tanstack/react-query";
import { VscodeTextarea } from "@vscode-elements/react-elements";
import clsx from "clsx";
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AutocompleteInput,
  LoadingBar,
  MarkdownDivWithReferences,
  MarkdownReference,
  PopOver,
  SegmentedControl,
} from "@tsmono/react/components";
import { ApiError } from "@tsmono/util";

import { ApplicationIcons } from "../../icons";
import { useStore } from "../../state/store";
import { useUserSettings } from "../../state/userSettings";
import type { Result, SearchInput } from "../../types/api-types";
import {
  ProjectConfigWithEtag,
  useProjectConfig,
} from "../server/useProjectConfig";
import {
  searchQueryKeys,
  useCachedSearchResult,
  useCreateSearch,
  useSearches,
} from "../server/useSearches";
import {
  autosizeTextarea,
  AutosizeTextareaConfig,
} from "../utils/autosizeTextarea";
import { SidebarHeader } from "../validation/components/ValidationCaseEditor";

import { useTranscriptNavigation } from "./hooks/useTranscriptNavigation";
import styles from "./SearchPanel.module.css";
import {
  createInitialSearchPanelState,
  getSearchPanelStateKey,
  normalizeSearchPanelState,
  SearchPanelState,
} from "./searchPanelState";
import { buildSearchRequest, buildSearchScope } from "./searchRequest";
import type {
  GrepOptions,
  SearchType,
  TranscriptSearchScope,
} from "./searchRequest";

type SearchPanelProps = {
  scope: TranscriptSearchScope;
  transcriptDir: string;
  transcriptId: string;
  onClose: () => void;
};

function hasStringValue(target: EventTarget | null): target is EventTarget & {
  value: string;
} {
  return (
    target !== null && "value" in target && typeof target.value === "string"
  );
}

function getInputValue(e: Event): string {
  return hasStringValue(e.target) ? e.target.value : "";
}

const SEARCH_TEXTAREA_AUTOSIZE: AutosizeTextareaConfig = {
  minRows: 2,
  maxRows: 10,
};

function getInnerTextarea(el: HTMLElement | null): HTMLTextAreaElement | null {
  const inner = el?.shadowRoot?.querySelector("textarea");
  return inner instanceof HTMLTextAreaElement ? inner : null;
}

function isSearchType(value: string): value is SearchType {
  return value === "llm" || value === "grep";
}

function applyRecentSearch(
  prev: SearchPanelState,
  search: SearchInput
): SearchPanelState {
  if (search.type === "llm") {
    return {
      ...prev,
      searchType: "llm",
      searches: {
        ...prev.searches,
        llm: {
          ...prev.searches.llm,
          query: search.query,
          model: search.model ?? "",
          searchId: search.search_id,
        },
      },
    };
  }

  return {
    ...prev,
    searchType: "grep",
    searches: {
      ...prev.searches,
      grep: {
        ...prev.searches.grep,
        query: search.query,
        grepOptions: {
          ignoreCase: search.ignore_case,
          regex: search.regex,
          wordBoundary: search.word_boundary,
        },
        searchId: search.search_id,
      },
    },
  };
}

export const SearchPanel = (props: SearchPanelProps) => {
  const result = useProjectConfig();

  if (result.loading) return <div className={styles.container}>Loading...</div>;
  if (result.error)
    return <div className={styles.container}>Error loading data</div>;

  return <SearchPanelWithData {...props} projectConfig={result.data} />;
};

type SearchPanelWithDataProps = SearchPanelProps & {
  projectConfig: ProjectConfigWithEtag;
};
const SearchPanelWithData = ({
  scope,
  transcriptDir,
  transcriptId,
  onClose,
  projectConfig,
}: SearchPanelWithDataProps) => {
  const { getMessageUrl, getEventUrl, getEventMessageUrl } =
    useTranscriptNavigation();
  const modelInputId = useId();
  const queryClient = useQueryClient();
  const searchPanelStateKey = useMemo(
    () => getSearchPanelStateKey({ scope, transcriptDir }),
    [scope, transcriptDir]
  );
  const storedState = useStore(
    (state) => state.searchPanelStates[searchPanelStateKey]
  );
  const setSearchPanelState = useStore((state) => state.setSearchPanelState);
  const searchModelHistory = useUserSettings(
    (state) => state.searchModelHistory
  );
  const recordSearchModel = useUserSettings((state) => state.recordSearchModel);

  const setState = useCallback(
    (
      updater: SearchPanelState | ((prev: SearchPanelState) => SearchPanelState)
    ) => {
      setSearchPanelState(searchPanelStateKey, updater);
    },
    [searchPanelStateKey, setSearchPanelState]
  );

  const state = normalizeSearchPanelState(storedState);
  const { searchType } = state;
  const activeBranch = state.searches[searchType];
  const { query, searchId } = activeBranch;
  const grepOptions = state.searches.grep.grepOptions;
  const model = state.searches.llm.model;

  const createSearchMutation = useCreateSearch({ transcriptDir, transcriptId });
  const cachedSearchQuery = useCachedSearchResult({
    transcriptDir,
    transcriptId,
    scope: buildSearchScope(scope),
    searchId,
  });

  const [isRecentOpen, setIsRecentOpen] = useState(false);
  const recentButtonRef = useRef<HTMLButtonElement>(null);

  const loading =
    createSearchMutation.isPending || cachedSearchQuery.isFetching;
  const error = createSearchMutation.error || cachedSearchQuery.error;
  const currentSearch: Result | null = cachedSearchQuery.data ?? null;
  const hasSearched =
    !!searchId ||
    createSearchMutation.isPending ||
    !!createSearchMutation.error;

  const clearSearchIdForCurrentType = useCallback(() => {
    createSearchMutation.reset();
    setState((prev) => ({
      ...prev,
      searches: {
        ...prev.searches,
        [prev.searchType]: {
          ...prev.searches[prev.searchType],
          searchId: null,
        },
      },
    }));
  }, [createSearchMutation, setState]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = query.trim();
      if (!text || loading) return;

      clearSearchIdForCurrentType();

      const resolvedModel =
        searchType === "llm"
          ? ((model.trim() || projectConfig.config.model?.trim()) ?? "")
          : "";

      const request = buildSearchRequest({
        grepOptions,
        model: resolvedModel,
        query: text,
        scope,
        searchType,
      });

      createSearchMutation.mutate(request, {
        onSuccess: (response) => {
          queryClient.setQueryData(
            searchQueryKeys.cachedResult({
              transcriptDir,
              transcriptId,
              scope: buildSearchScope(scope),
              searchId: response.id,
            }),
            response.result
          );
          setState((prev) => ({
            ...prev,
            searches: {
              ...prev.searches,
              [searchType]: {
                ...prev.searches[searchType],
                searchId: response.id,
              },
            },
          }));
          if (searchType === "llm") {
            recordSearchModel(resolvedModel);
          }
        },
      });
    },
    [
      clearSearchIdForCurrentType,
      createSearchMutation,
      grepOptions,
      loading,
      model,
      projectConfig.config.model,
      query,
      queryClient,
      recordSearchModel,
      scope,
      searchType,
      setState,
      transcriptDir,
      transcriptId,
    ]
  );

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.closest("form")?.requestSubmit();
    }
  }, []);

  const handleSelectRecent = useCallback(
    (search: SearchInput) => {
      createSearchMutation.reset();
      setIsRecentOpen(false);
      setState((prev) => applyRecentSearch(prev, search));
    },
    [createSearchMutation, setState]
  );

  const handleNewSearch = useCallback(() => {
    createSearchMutation.reset();
    setState(createInitialSearchPanelState());
  }, [createSearchMutation, setState]);

  const toggleGrepOption = useCallback(
    (key: keyof GrepOptions) => {
      createSearchMutation.reset();
      setState((prev) => ({
        ...prev,
        searches: {
          ...prev.searches,
          grep: {
            ...prev.searches.grep,
            grepOptions: {
              ...prev.searches.grep.grepOptions,
              [key]: !prev.searches.grep.grepOptions[key],
            },
            searchId: null,
          },
        },
      }));
    },
    [createSearchMutation, setState]
  );

  const handleSearchTypeChange = useCallback(
    (type: SearchType) => {
      setState((prev) => ({ ...prev, searchType: type }));
    },
    [setState]
  );

  const searchTextareaRef = useRef<HTMLElement | null>(null);
  const handleSearchTextareaRef = useCallback((el: HTMLElement | null) => {
    searchTextareaRef.current = el;
  }, []);
  useLayoutEffect(() => {
    const inner = getInnerTextarea(searchTextareaRef.current);
    if (inner !== null) {
      autosizeTextarea(inner, SEARCH_TEXTAREA_AUTOSIZE);
    }
  }, [query]);

  const handleQueryInput = useCallback(
    (e: Event) => {
      const value = getInputValue(e);
      createSearchMutation.reset();
      setState((prev) => ({
        ...prev,
        searches: {
          ...prev.searches,
          [prev.searchType]: {
            ...prev.searches[prev.searchType],
            query: value,
            searchId: null,
          },
        },
      }));
    },
    [createSearchMutation, setState]
  );

  const handleModelChange = useCallback(
    (value: string) => {
      createSearchMutation.reset();
      setState((prev) => ({
        ...prev,
        searches: {
          ...prev.searches,
          llm: {
            ...prev.searches.llm,
            model: value,
            searchId: null,
          },
        },
      }));
    },
    [createSearchMutation, setState]
  );

  return (
    <div className={styles.container}>
      <SidebarHeader
        icon={ApplicationIcons.search}
        title={`Search: ${scope}`}
        onClose={onClose}
      />
      <div className={styles.body}>
        <form className={styles.searchArea} onSubmit={handleSubmit}>
          <div className={styles.topRow}>
            <div className={styles.typeToggle}>
              <SegmentedControl
                selectedId={searchType}
                segments={[
                  { id: "llm", label: "LLM" },
                  { id: "grep", label: "Grep" },
                ]}
                onSegmentChange={(segmentId) => {
                  if (isSearchType(segmentId)) {
                    handleSearchTypeChange(segmentId);
                  }
                }}
              />
            </div>
            <div className={styles.topActions}>
              <button
                ref={recentButtonRef}
                type="button"
                className={clsx(
                  styles.iconAction,
                  isRecentOpen && styles.iconActionActive
                )}
                onClick={() => setIsRecentOpen((prev) => !prev)}
                title="Recent searches"
                aria-label="Recent searches"
                aria-expanded={isRecentOpen}
              >
                <i className={ApplicationIcons.history} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.iconAction}
                onClick={handleNewSearch}
                title="New search"
                aria-label="New search"
              >
                <i className={ApplicationIcons.add} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className={styles.inputShell}>
            <VscodeTextarea
              ref={handleSearchTextareaRef}
              className={styles.textarea}
              placeholder={
                searchType === "grep"
                  ? "Search for text..."
                  : "Ask a question about this transcript..."
              }
              value={query}
              onInput={handleQueryInput}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autocomplete="off"
            />
          </div>
          <div className={styles.controlsRow}>
            <div className={styles.modeRow}>
              {searchType === "grep" ? (
                <div className={styles.modeControls}>
                  <ModeToggle
                    icon="case-sensitive"
                    title="Ignore Case"
                    active={grepOptions.ignoreCase}
                    onClick={() => toggleGrepOption("ignoreCase")}
                  />
                  <ModeToggle
                    icon="regex"
                    title="Regex"
                    active={grepOptions.regex}
                    onClick={() => toggleGrepOption("regex")}
                  />
                  <ModeToggle
                    icon="whole-word"
                    title="Whole Word"
                    active={grepOptions.wordBoundary}
                    onClick={() => toggleGrepOption("wordBoundary")}
                  />
                </div>
              ) : (
                <div className={styles.modelPill}>
                  <div className={styles.modelInputShell}>
                    <AutocompleteInput
                      id={modelInputId}
                      className={styles.modelInput}
                      placeholder={
                        projectConfig.config.model ?? "e.g., openai/gpt-5"
                      }
                      value={model}
                      onChange={handleModelChange}
                      suggestions={searchModelHistory}
                      allowBrowse={searchModelHistory.length > 0}
                      required
                    />
                  </div>
                </div>
              )}
            </div>
            <button
              type="submit"
              className={styles.runButton}
              disabled={loading || !query.trim()}
            >
              Run
            </button>
          </div>
        </form>
        <LoadingBar loading={loading} />
        <div className={styles.results}>
          <SearchResults
            loading={loading}
            error={error}
            hasSearched={hasSearched}
            currentSearch={currentSearch}
            scope={scope}
            getMessageUrl={getMessageUrl}
            getEventUrl={getEventUrl}
            getEventMessageUrl={getEventMessageUrl}
          />
        </div>
      </div>
      <PopOver
        id={`recent-searches-${transcriptId}`}
        isOpen={isRecentOpen}
        setIsOpen={setIsRecentOpen}
        // eslint-disable-next-line react-hooks/refs -- positionEl accepts null; PopOver/Popper handles this in effects and updates when ref is populated
        positionEl={recentButtonRef.current}
        placement="bottom-end"
        offset={[0, 2]}
        hoverDelay={-1}
        closeOnMouseLeave={false}
        showArrow={false}
        styles={{
          padding: 0,
          width: "20rem",
          maxWidth: "calc(100vw - 1rem)",
          maxHeight: "60vh",
          overflowY: "auto",
        }}
      >
        <RecentSearches searchType={searchType} onSelect={handleSelectRecent} />
      </PopOver>
    </div>
  );
};

const ModeToggle: FC<{
  active: boolean;
  icon: string;
  title: string;
  onClick: () => void;
}> = ({ active, icon, title, onClick }) => (
  <button
    type="button"
    className={clsx(styles.modeToggle, active && styles.modeToggleActive)}
    onClick={onClick}
    aria-pressed={active}
    title={title}
  >
    <i className={`codicon codicon-${icon}`} />
  </button>
);

const RecentSearches: FC<{
  searchType: SearchType;
  onSelect: (search: SearchInput) => void;
}> = ({ searchType, onSelect }) => {
  const searches = useSearches({ searchType });

  if (searches.loading) {
    return <div className={styles.recentEmpty}>Loading recent searches…</div>;
  }

  if (searches.error) {
    return (
      <div className={styles.recentEmpty}>Unable to load recent searches.</div>
    );
  }

  const items = searches.data.items;

  if (items.length === 0) {
    return <div className={styles.recentEmpty}>No recent searches.</div>;
  }

  return (
    <ul className={styles.recentList} role="listbox">
      {items.map((search) => (
        <li
          key={search.search_id}
          role="option"
          aria-selected={false}
          className={styles.recentItem}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(search);
          }}
        >
          {search.query}
        </li>
      ))}
    </ul>
  );
};

const SearchResults: FC<{
  loading: boolean;
  error: Error | null;
  hasSearched: boolean;
  currentSearch: Result | null;
  scope: TranscriptSearchScope;
  getMessageUrl: (id: string) => string | undefined;
  getEventUrl: (id: string) => string | undefined;
  getEventMessageUrl: (id: string) => string | undefined;
}> = ({
  loading,
  error,
  hasSearched,
  currentSearch,
  scope,
  getMessageUrl,
  getEventUrl,
  getEventMessageUrl,
}) => {
  if (loading) {
    return (
      <div className={styles.emptyState}>
        <p>
          <i className={ApplicationIcons.search} /> Searching…
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.emptyState}>
        <p>
          {error instanceof ApiError ? error.status : ""} Something went wrong
        </p>
        <p>{error.message}</p>
      </div>
    );
  }
  if (!hasSearched) {
    return null;
  }
  // currentSearch is null when the active search hasn't been run for this
  // transcript yet (cache miss). Render nothing — only show "No results
  // found" once we have a result that turned out to be empty.
  if (currentSearch === null) {
    return null;
  }

  const result = currentSearch;
  const numericValue = typeof result.value === "number" ? result.value : null;
  const isEmpty =
    numericValue === 0 &&
    !result.explanation &&
    typeof result.value !== "string";

  if (isEmpty) {
    return <div className={styles.emptyState}>No results found</div>;
  }

  return (
    <>
      <div className={styles.sectionHeader}>
        <span>Results</span>
        {numericValue !== null && numericValue > 0 && (
          <span className={styles.matchCount}>
            {numericValue} {numericValue === 1 ? "match" : "matches"}
          </span>
        )}
      </div>
      <SearchResult
        result={result}
        scope={scope}
        getMessageUrl={getMessageUrl}
        getEventUrl={getEventUrl}
        getEventMessageUrl={getEventMessageUrl}
      />
    </>
  );
};

const SearchResult: FC<{
  result: Result;
  scope: TranscriptSearchScope;
  getMessageUrl: (id: string) => string | undefined;
  getEventUrl: (id: string) => string | undefined;
  getEventMessageUrl: (id: string) => string | undefined;
}> = ({ result, scope, getMessageUrl, getEventUrl, getEventMessageUrl }) => {
  const markdownRefs = useMemo((): MarkdownReference[] => {
    const seen = new Set<string>();
    const refs: MarkdownReference[] = [];
    for (const ref of result.references ?? []) {
      if (ref.cite && !seen.has(ref.cite)) {
        seen.add(ref.cite);
        const route =
          ref.type === "message"
            ? scope === "events"
              ? getEventMessageUrl(ref.id)
              : getMessageUrl(ref.id)
            : ref.type === "event"
              ? getEventUrl(ref.id)
              : undefined;
        refs.push({
          id: ref.id,
          cite: ref.cite,
          citeUrl: route ? `#${route}` : undefined,
        });
      }
    }
    return refs;
  }, [
    result.references,
    scope,
    getMessageUrl,
    getEventUrl,
    getEventMessageUrl,
  ]);

  return (
    <div className={styles.resultCard}>
      {result.explanation && (
        <MarkdownDivWithReferences
          markdown={result.explanation}
          references={markdownRefs}
          renderer="textOnly"
        />
      )}
      {typeof result.value === "string" && (
        <MarkdownDivWithReferences
          markdown={result.value}
          references={markdownRefs}
          renderer="textOnly"
        />
      )}
    </div>
  );
};
