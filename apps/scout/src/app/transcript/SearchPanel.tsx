import { VscodeTextarea } from "@vscode-elements/react-elements";
import clsx from "clsx";
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useId,
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

import { ApplicationIcons } from "../../icons";
import { useStore } from "../../state/store";
import { useUserSettings } from "../../state/userSettings";
import type { Result, SearchInput } from "../../types/api-types";
import { useProjectConfig } from "../server/useProjectConfig";
import {
  useCachedSearchResult,
  useCreateSearch,
  useSearches,
} from "../server/useSearches";
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

function configureSearchTextarea(el: HTMLElement | null) {
  if (!el) return;
  el.setAttribute("spellcheck", "false");
  const shadowTextarea = el.shadowRoot?.querySelector("textarea");
  if (shadowTextarea instanceof HTMLTextAreaElement) {
    shadowTextarea.setAttribute("spellcheck", "false");
  }
}

function isSearchType(value: string): value is SearchType {
  return value === "llm" || value === "grep";
}

export const SearchPanel = ({
  scope,
  transcriptDir,
  transcriptId,
  onClose,
}: SearchPanelProps) => {
  const projectConfig = useProjectConfig();
  const { getFullMessageUrl, getFullEventUrl, getFullEventMessageUrl } =
    useTranscriptNavigation();
  const modelInputId = useId();
  const searchPanelStateKey = useMemo(
    () => getSearchPanelStateKey({ scope, transcriptDir, transcriptId }),
    [scope, transcriptDir, transcriptId]
  );
  const storedState = useStore(
    (state) => state.searchPanelStates[searchPanelStateKey]
  );
  const setSearchPanelState = useStore((state) => state.setSearchPanelState);
  const searchModelHistory = useUserSettings(
    (state) => state.searchModelHistory
  );
  const recordSearchModel = useUserSettings((state) => state.recordSearchModel);

  const createSearchMutation = useCreateSearch({ transcriptDir, transcriptId });
  const cachedSearchMutation = useCachedSearchResult({
    transcriptDir,
    transcriptId,
  });

  const state = normalizeSearchPanelState(storedState);
  const setState = useCallback(
    (
      updater: SearchPanelState | ((prev: SearchPanelState) => SearchPanelState)
    ) => {
      setSearchPanelState(searchPanelStateKey, updater);
    },
    [searchPanelStateKey, setSearchPanelState]
  );
  const { searchType } = state;
  const activeState = state.searches[searchType];
  const { query, hasSearched, currentSearch } = activeState;
  const grepOptions = state.searches.grep.grepOptions;
  const model = state.searches.llm.model;

  const [isRecentOpen, setIsRecentOpen] = useState(false);
  const recentButtonRef = useRef<HTMLButtonElement>(null);
  const recentLookupSearchIdRef = useRef<string | null>(null);

  const loading =
    createSearchMutation.isPending || cachedSearchMutation.isPending;

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = query.trim();
      if (!text || loading) return;

      setState((prev) => ({
        ...prev,
        searches: {
          ...prev.searches,
          [searchType]: {
            ...prev.searches[searchType],
            hasSearched: true,
            currentSearch: null,
          },
        },
      }));
      createSearchMutation.reset();
      cachedSearchMutation.reset();
      recentLookupSearchIdRef.current = null;

      const resolvedModel =
        searchType === "llm"
          ? model.trim() || projectConfig.data?.config.model?.trim() || ""
          : "";

      const request = buildSearchRequest({
        grepOptions,
        model: resolvedModel,
        query: text,
        scope,
        searchType,
      });

      createSearchMutation.mutate(request, {
        onSuccess: (result) => {
          setState((prev) => ({
            ...prev,
            searches: {
              ...prev.searches,
              [searchType]: {
                ...prev.searches[searchType],
                currentSearch: result,
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
      cachedSearchMutation,
      createSearchMutation,
      grepOptions,
      searchType,
      loading,
      model,
      scope,
      projectConfig.data?.config.model,
      query,
      recordSearchModel,
      setState,
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
      cachedSearchMutation.reset();
      recentLookupSearchIdRef.current = search.search_id;
      setIsRecentOpen(false);
      setState((prev) => {
        if (search.type === "llm") {
          return {
            ...prev,
            searchType: search.type,
            searches: {
              ...prev.searches,
              llm: {
                ...prev.searches.llm,
                currentSearch: null,
                hasSearched: false,
                model: search.model ?? "",
                query: search.query,
              },
            },
          };
        } else {
          return {
            ...prev,
            searchType: search.type,
            searches: {
              ...prev.searches,
              grep: {
                ...prev.searches.grep,
                currentSearch: null,
                grepOptions: {
                  ignoreCase: search.ignore_case,
                  regex: search.regex,
                  wordBoundary: search.word_boundary,
                },
                hasSearched: false,
                query: search.query,
              },
            },
          };
        }
      });
      cachedSearchMutation.mutate(
        {
          scope: buildSearchScope(scope),
          searchId: search.search_id,
        },
        {
          onSuccess: (searchResult) => {
            if (
              searchResult &&
              recentLookupSearchIdRef.current === search.search_id
            ) {
              setState((prev) => ({
                ...prev,
                searches: {
                  ...prev.searches,
                  [search.type]: {
                    ...prev.searches[search.type],
                    currentSearch: searchResult,
                    hasSearched: true,
                  },
                },
              }));
            }
          },
        }
      );
    },
    [cachedSearchMutation, createSearchMutation, scope, setState]
  );

  const handleNewSearch = useCallback(() => {
    createSearchMutation.reset();
    cachedSearchMutation.reset();
    recentLookupSearchIdRef.current = null;
    setState(createInitialSearchPanelState());
  }, [cachedSearchMutation, createSearchMutation, setState]);

  const toggleGrepOption = useCallback(
    (key: keyof GrepOptions) => {
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
          },
        },
      }));
    },
    [setState]
  );

  const handleSearchTypeChange = useCallback(
    (type: SearchType) => {
      setState((prev) => ({ ...prev, searchType: type }));
    },
    [setState]
  );

  const handleQueryInput = useCallback(
    (e: Event) => {
      const value = getInputValue(e);
      setState((prev) => ({
        ...prev,
        searches: {
          ...prev.searches,
          [prev.searchType]: {
            ...prev.searches[prev.searchType],
            query: value,
          },
        },
      }));
    },
    [setState]
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
            {/* TODO: grow up to 10 lines tall and then scroll */}
            <VscodeTextarea
              ref={configureSearchTextarea}
              className={styles.textarea}
              placeholder={
                searchType === "grep"
                  ? "Search for text..."
                  : "Ask a question about this transcript..."
              }
              value={query}
              rows={4}
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
                        projectConfig.data?.config.model ?? undefined
                      }
                      value={model}
                      onChange={(value) =>
                        setState((prev) => ({
                          ...prev,
                          searches: {
                            ...prev.searches,
                            llm: {
                              ...prev.searches.llm,
                              model: value,
                            },
                          },
                        }))
                      }
                      suggestions={searchModelHistory}
                      allowBrowse={searchModelHistory.length > 0}
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
            isError={
              createSearchMutation.isError || cachedSearchMutation.isError
            }
            hasSearched={hasSearched}
            currentSearch={currentSearch}
            scope={scope}
            getFullMessageUrl={getFullMessageUrl}
            getFullEventUrl={getFullEventUrl}
            getFullEventMessageUrl={getFullEventMessageUrl}
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
  isError: boolean;
  hasSearched: boolean;
  currentSearch: Result | null;
  scope: TranscriptSearchScope;
  getFullMessageUrl: (id: string) => string | undefined;
  getFullEventUrl: (id: string) => string | undefined;
  getFullEventMessageUrl: (id: string) => string | undefined;
}> = ({
  loading,
  isError,
  hasSearched,
  currentSearch,
  scope,
  getFullMessageUrl,
  getFullEventUrl,
  getFullEventMessageUrl,
}) => {
  if (loading) {
    return <div className={styles.emptyState}>Searching…</div>;
  }
  if (isError) {
    return <div className={styles.emptyState}>Search failed. Try again.</div>;
  }
  if (!hasSearched) {
    return null;
  }
  if (currentSearch === null) {
    return <div className={styles.emptyState}>No results found</div>;
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
        getFullMessageUrl={getFullMessageUrl}
        getFullEventUrl={getFullEventUrl}
        getFullEventMessageUrl={getFullEventMessageUrl}
      />
    </>
  );
};

const SearchResult: FC<{
  result: Result;
  scope: TranscriptSearchScope;
  getFullMessageUrl: (id: string) => string | undefined;
  getFullEventUrl: (id: string) => string | undefined;
  getFullEventMessageUrl: (id: string) => string | undefined;
}> = ({
  result,
  scope,
  getFullMessageUrl,
  getFullEventUrl,
  getFullEventMessageUrl,
}) => {
  const markdownRefs = useMemo((): MarkdownReference[] => {
    const seen = new Set<string>();
    const refs: MarkdownReference[] = [];
    for (const ref of result.references ?? []) {
      if (ref.cite && !seen.has(ref.cite)) {
        seen.add(ref.cite);
        refs.push({
          id: ref.id,
          cite: ref.cite,
          citeUrl:
            ref.type === "message"
              ? scope === "events"
                ? getFullEventMessageUrl(ref.id)
                : getFullMessageUrl(ref.id)
              : ref.type === "event"
                ? getFullEventUrl(ref.id)
                : undefined,
        });
      }
    }
    return refs;
  }, [
    result.references,
    scope,
    getFullMessageUrl,
    getFullEventUrl,
    getFullEventMessageUrl,
  ]);

  // TODO: could try ResultPanel, maybe doesn't fit our needs
  return (
    <div className={styles.resultCard}>
      {result.explanation && (
        <MarkdownDivWithReferences
          markdown={result.explanation}
          references={markdownRefs}
          renderer="simple"
        />
      )}
      {typeof result.value === "string" && (
        <MarkdownDivWithReferences
          markdown={result.value}
          references={markdownRefs}
          renderer="simple"
        />
      )}
    </div>
  );
};
