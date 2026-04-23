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
  MarkdownDivWithReferences,
  MarkdownReference,
  PopOver,
  SegmentedControl,
} from "@tsmono/react/components";

import { ApplicationIcons } from "../../icons";
import { useStore } from "../../state/store";
import { useUserSettings } from "../../state/userSettings";
import { Result, SavedSearch } from "../../types/api-types";
import { useProjectConfig } from "../server/useProjectConfig";
import { useCreateSearch, useSearches } from "../server/useSearches";
import { SidebarHeader } from "../validation/components/ValidationCaseEditor";

import { useTranscriptNavigation } from "./hooks/useTranscriptNavigation";
import styles from "./SearchPanel.module.css";
import {
  createInitialSearchPanelState,
  getSearchPanelStateKey,
  SearchPanelState,
} from "./searchPanelState";
import { buildSearchRequest } from "./searchRequest";
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

function getInputValue(e: Event): string {
  return (e.target as HTMLTextAreaElement).value;
}

function configureSearchTextarea(el: HTMLElement | null) {
  if (!el) return;
  el.setAttribute("spellcheck", "false");
  const shadowTextarea = el.shadowRoot?.querySelector("textarea");
  if (shadowTextarea instanceof HTMLTextAreaElement) {
    shadowTextarea.setAttribute("spellcheck", "false");
  }
}

export const SearchPanel = ({
  scope,
  transcriptDir,
  transcriptId,
  onClose,
}: SearchPanelProps) => {
  const projectConfig = useProjectConfig();
  const { getFullMessageUrl, getFullEventUrl } = useTranscriptNavigation();
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

  const state = storedState ?? createInitialSearchPanelState();
  const setState = useCallback(
    (
      updater: SearchPanelState | ((prev: SearchPanelState) => SearchPanelState)
    ) => {
      setSearchPanelState(searchPanelStateKey, updater);
    },
    [searchPanelStateKey, setSearchPanelState]
  );
  const { query, searchType, hasSearched, currentSearch, grepOptions, model } =
    state;

  const [isRecentOpen, setIsRecentOpen] = useState(false);
  const recentButtonRef = useRef<HTMLButtonElement>(null);

  const loading = createSearchMutation.isPending;

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = query.trim();
      if (!text || loading) return;

      setState((prev) => ({
        ...prev,
        hasSearched: true,
        currentSearch: null,
      }));
      createSearchMutation.reset();

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
        onSuccess: (search) => {
          setState((prev) => ({ ...prev, currentSearch: search }));
          if (search.type === "llm") {
            recordSearchModel(resolvedModel);
          }
        },
      });
    },
    [
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
    (search: SavedSearch) => {
      createSearchMutation.reset();
      setIsRecentOpen(false);
      setState((prev) => {
        const next: SearchPanelState = {
          ...prev,
          currentSearch: search,
          hasSearched: true,
          query: search.query,
          searchType: search.type,
        };
        if (search.type === "llm") {
          next.model = search.model ?? "";
        } else {
          next.grepOptions = {
            ignoreCase: search.ignore_case,
            regex: search.regex,
            wordBoundary: search.word_boundary,
          };
        }
        return next;
      });
    },
    [createSearchMutation, setState]
  );

  const handleNewSearch = useCallback(() => {
    createSearchMutation.reset();
    setState(createInitialSearchPanelState());
  }, [createSearchMutation, setState]);

  const toggleGrepOption = useCallback(
    (key: keyof GrepOptions) => {
      setState((prev) => ({
        ...prev,
        grepOptions: { ...prev.grepOptions, [key]: !prev.grepOptions[key] },
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
      setState((prev) => ({ ...prev, query: getInputValue(e) }));
    },
    [setState]
  );

  return (
    <div className={styles.container}>
      <SidebarHeader
        icon={ApplicationIcons.search}
        title="Search"
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
                onSegmentChange={(segmentId) =>
                  handleSearchTypeChange(segmentId as SearchType)
                }
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
                          model: value,
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
              {loading ? "Running..." : "Run"}
            </button>
          </div>
        </form>
        <div className={styles.results}>
          <SearchResults
            loading={loading}
            isError={createSearchMutation.isError}
            hasSearched={hasSearched}
            currentSearch={currentSearch}
            getFullMessageUrl={getFullMessageUrl}
            getFullEventUrl={getFullEventUrl}
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
        <RecentSearches
          transcriptDir={transcriptDir}
          transcriptId={transcriptId}
          searchType={searchType}
          onSelect={handleSelectRecent}
        />
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
  transcriptDir: string;
  transcriptId: string;
  searchType: SearchType;
  onSelect: (search: SavedSearch) => void;
}> = ({ transcriptDir, transcriptId, searchType, onSelect }) => {
  const searches = useSearches({ transcriptDir, transcriptId });

  if (searches.loading) {
    return <div className={styles.recentEmpty}>Loading recent searches…</div>;
  }

  if (searches.error) {
    return (
      <div className={styles.recentEmpty}>Unable to load recent searches.</div>
    );
  }

  const items = searches.data.items.filter(
    (search) => search.type === searchType
  );

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
  currentSearch: SavedSearch | null;
  getFullMessageUrl: (id: string) => string | undefined;
  getFullEventUrl: (id: string) => string | undefined;
}> = ({
  loading,
  isError,
  hasSearched,
  currentSearch,
  getFullMessageUrl,
  getFullEventUrl,
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
  if (currentSearch === null || currentSearch.results.length === 0) {
    return <div className={styles.emptyState}>No results found</div>;
  }

  const total = currentSearch.results.reduce(
    (sum, r) => (typeof r.value === "number" ? sum + r.value : sum),
    0
  );

  return (
    <>
      <div className={styles.sectionHeader}>
        <span>Results</span>
        {total > 0 && (
          <span className={styles.matchCount}>
            {total} {total === 1 ? "match" : "matches"}
          </span>
        )}
      </div>
      {currentSearch.results.map((result, index) => (
        <SearchResult
          key={result.uuid ?? index}
          result={result}
          getFullMessageUrl={getFullMessageUrl}
          getFullEventUrl={getFullEventUrl}
        />
      ))}
    </>
  );
};

const SearchResult: FC<{
  result: Result;
  getFullMessageUrl: (id: string) => string | undefined;
  getFullEventUrl: (id: string) => string | undefined;
}> = ({ result, getFullMessageUrl, getFullEventUrl }) => {
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
              ? getFullMessageUrl(ref.id)
              : ref.type === "event"
                ? getFullEventUrl(ref.id)
                : undefined,
        });
      }
    }
    return refs;
  }, [result.references, getFullMessageUrl, getFullEventUrl]);

  // TODO: could try ResultPanel, maybe doesn't fit our needs
  return (
    <div className={styles.resultCard}>
      {result.explanation && (
        <MarkdownDivWithReferences
          markdown={result.explanation}
          references={markdownRefs}
        />
      )}
      {typeof result.value === "string" && (
        <MarkdownDivWithReferences
          markdown={result.value}
          references={markdownRefs}
        />
      )}
    </div>
  );
};
