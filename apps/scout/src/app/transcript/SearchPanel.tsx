import { VscodeTextarea } from "@vscode-elements/react-elements";
import clsx from "clsx";
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useMemo,
  useState,
} from "react";

import {
  MarkdownDivWithReferences,
  MarkdownReference,
  SegmentedControl,
} from "@tsmono/react/components";

import { ApplicationIcons } from "../../components/icons";
import { Result, SavedSearch } from "../../types/api-types";
import { Chip } from "../components/Chip";
import { ChipGroup } from "../components/ChipGroup";
import { useProjectConfig } from "../server/useProjectConfig";
import { useCreateSearch, useSearches } from "../server/useSearches";
import { SidebarHeader } from "../validation/components/ValidationCaseEditor";

import { useTranscriptNavigation } from "./hooks/useTranscriptNavigation";
import styles from "./SearchPanel.module.css";
import { buildSearchRequest } from "./searchRequest";
import type {
  GrepOptions,
  SearchType,
  TranscriptSearchScope,
} from "./searchRequest";

type PanelView = "results" | "recent";

type SearchPanelState = {
  query: string;
  searchType: SearchType;
  panelView: PanelView;
  hasSearched: boolean;
  currentSearch: SavedSearch | null;
  grepOptions: GrepOptions;
  model: string;
};

const initialState: SearchPanelState = {
  query: "",
  searchType: "llm",
  panelView: "results",
  hasSearched: false,
  currentSearch: null,
  grepOptions: {
    ignoreCase: true,
    regex: false,
    wordBoundary: false,
  },
  model: "",
};

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
  const { getFullMessageUrl } = useTranscriptNavigation();

  const createSearchMutation = useCreateSearch({ transcriptDir, transcriptId });

  const [state, setState] = useState<SearchPanelState>(initialState);
  const {
    query,
    searchType,
    panelView,
    hasSearched,
    currentSearch,
    grepOptions,
    model,
  } = state;

  const loading = createSearchMutation.isPending;

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = query.trim();
      if (!text || loading) return;

      setState((prev) => ({
        ...prev,
        hasSearched: true,
        panelView: "results",
        currentSearch: null,
      }));
      createSearchMutation.reset();

      const request = buildSearchRequest({
        defaultModel: projectConfig.data?.config.model,
        grepOptions,
        model,
        query: text,
        scope,
        searchType,
      });

      createSearchMutation.mutate(request, {
        onSuccess: (search) =>
          setState((prev) => ({ ...prev, currentSearch: search })),
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
      setState((prev) => {
        const next: SearchPanelState = {
          ...prev,
          currentSearch: search,
          hasSearched: true,
          query: search.query,
          searchType: search.type,
          panelView: "results",
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
    [createSearchMutation]
  );

  const handleNewSearch = useCallback(() => {
    createSearchMutation.reset();
    setState(initialState);
  }, [createSearchMutation]);

  const toggleGrepOption = useCallback((key: keyof GrepOptions) => {
    setState((prev) => ({
      ...prev,
      grepOptions: { ...prev.grepOptions, [key]: !prev.grepOptions[key] },
    }));
  }, []);

  const handleSearchTypeChange = useCallback((type: SearchType) => {
    setState((prev) => ({ ...prev, searchType: type }));
  }, []);

  const handleQueryInput = useCallback((e: Event) => {
    setState((prev) => ({ ...prev, query: getInputValue(e) }));
  }, []);

  const showResults = panelView === "results";
  const showRecentSearches = panelView === "recent";

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
                type="button"
                className={clsx(
                  styles.iconAction,
                  showRecentSearches && styles.iconActionActive
                )}
                onClick={() =>
                  setState((prev) => ({ ...prev, panelView: "recent" }))
                }
                title="Recent searches"
                aria-label="Recent searches"
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
                    label="Ignore Case"
                    active={grepOptions.ignoreCase}
                    onClick={() => toggleGrepOption("ignoreCase")}
                  />
                  <ModeToggle
                    label="Regex"
                    active={grepOptions.regex}
                    onClick={() => toggleGrepOption("regex")}
                  />
                  <ModeToggle
                    label="Whole Word"
                    active={grepOptions.wordBoundary}
                    onClick={() => toggleGrepOption("wordBoundary")}
                  />
                </div>
              ) : (
                <div className={styles.modelPill}>
                  <i
                    className={clsx(ApplicationIcons.model, styles.modelIcon)}
                  />
                  <span className={styles.modelLabel}>Model</span>
                  <input
                    type="text"
                    className={styles.modelInput}
                    placeholder={
                      projectConfig.data?.config.model || "Project default"
                    }
                    value={model}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        model: e.target.value,
                      }))
                    }
                  />
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
          {showResults && loading && (
            <div className={styles.emptyState}>Searching…</div>
          )}
          {showResults && !loading && createSearchMutation.isError && (
            <div className={styles.emptyState}>Search failed. Try again.</div>
          )}
          {showResults &&
            !loading &&
            !createSearchMutation.isError &&
            hasSearched &&
            currentSearch === null && (
              <div className={styles.emptyState}>No results found</div>
            )}
          {showResults &&
            !loading &&
            !createSearchMutation.isError &&
            hasSearched &&
            currentSearch !== null &&
            currentSearch.results.length === 0 && (
              <div className={styles.emptyState}>No results found</div>
            )}
          {showResults &&
            !loading &&
            currentSearch !== null &&
            currentSearch.results.length > 0 && (
              <div className={styles.sectionHeader}>Results</div>
            )}
          {showResults &&
            currentSearch?.results.map((result, index) => (
              <SearchResult
                key={result.uuid ?? index}
                result={result}
                getFullMessageUrl={getFullMessageUrl}
              />
            ))}
          {showRecentSearches && (
            <RecentSearches
              transcriptDir={transcriptDir}
              transcriptId={transcriptId}
              onSelect={handleSelectRecent}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const ModeToggle: FC<{
  active: boolean;
  label: string;
  onClick: () => void;
}> = ({ active, label, onClick }) => (
  <button
    type="button"
    className={clsx(styles.modeToggle, active && styles.modeToggleActive)}
    onClick={onClick}
    aria-pressed={active}
  >
    {label}
  </button>
);

const RecentSearches: FC<{
  transcriptDir: string;
  transcriptId: string;
  onSelect: (search: SavedSearch) => void;
}> = ({ transcriptDir, transcriptId, onSelect }) => {
  const searches = useSearches({ transcriptDir, transcriptId });

  if (searches.loading) {
    return <div className={styles.emptyState}>Loading recent searches…</div>;
  }

  if (searches.error) {
    return (
      <div className={styles.emptyState}>Unable to load recent searches.</div>
    );
  }

  const items = searches.data.items;

  if (items.length === 0) {
    return (
      <div className={styles.emptyState}>
        Recent searches will show up here.
      </div>
    );
  }

  return (
    <div className={styles.recentSearches}>
      <div className={styles.sectionHeader}>Recent searches</div>
      {items.map((search) => (
        <button
          key={search.search_id}
          type="button"
          className={styles.recentItem}
          onClick={() => onSelect(search)}
        >
          <div className={styles.recentQuery}>{search.query}</div>
          <ChipGroup className={styles.recentMeta}>
            <Chip value={search.type === "llm" ? "LLM" : "Grep"} />
            {search.type === "llm" && search.model ? (
              <Chip label="Model" value={search.model} />
            ) : undefined}
            {search.type === "grep" && search.regex ? (
              <Chip value="Regex" />
            ) : undefined}
            {search.type === "grep" && search.word_boundary ? (
              <Chip value="Whole Word" />
            ) : undefined}
            {search.type === "grep" && search.ignore_case ? (
              <Chip value="Ignore Case" />
            ) : undefined}
          </ChipGroup>
        </button>
      ))}
    </div>
  );
};

const SearchResult: FC<{
  result: Result;
  getFullMessageUrl: (id: string) => string | undefined;
}> = ({ result, getFullMessageUrl }) => {
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
            ref.type === "message" ? getFullMessageUrl(ref.id) : undefined,
        });
      }
    }
    return refs;
  }, [result.references, getFullMessageUrl]);

  const matchCount =
    typeof result.value === "number" ? result.value : undefined;

  // TODO: could try ResultPanel, maybe doesn't fit our needs
  return (
    <div className={styles.resultCard}>
      {matchCount !== undefined && (
        <div className={styles.matchCount}>
          {matchCount} {matchCount === 1 ? "match" : "matches"}
        </div>
      )}
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
