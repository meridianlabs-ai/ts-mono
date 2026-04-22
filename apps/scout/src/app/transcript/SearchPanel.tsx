import { VscodeTextarea } from "@vscode-elements/react-elements";
import clsx from "clsx";
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  MarkdownDivWithReferences,
  MarkdownReference,
  PopOver,
  SegmentedControl,
} from "@tsmono/react/components";

import { ApplicationIcons } from "../../icons";
import { Result, SavedSearch } from "../../types/api-types";
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

type SearchPanelState = {
  query: string;
  searchType: SearchType;
  hasSearched: boolean;
  currentSearch: SavedSearch | null;
  grepOptions: GrepOptions;
  model: string;
};

const initialState: SearchPanelState = {
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
  const { getFullMessageUrl, getFullEventUrl } = useTranscriptNavigation();

  const createSearchMutation = useCreateSearch({ transcriptDir, transcriptId });

  const [state, setState] = useState<SearchPanelState>(initialState);
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
          {loading && <div className={styles.emptyState}>Searching…</div>}
          {!loading && createSearchMutation.isError && (
            <div className={styles.emptyState}>Search failed. Try again.</div>
          )}
          {!loading &&
            !createSearchMutation.isError &&
            hasSearched &&
            currentSearch === null && (
              <div className={styles.emptyState}>No results found</div>
            )}
          {!loading &&
            !createSearchMutation.isError &&
            hasSearched &&
            currentSearch !== null &&
            currentSearch.results.length === 0 && (
              <div className={styles.emptyState}>No results found</div>
            )}
          {!loading &&
            currentSearch !== null &&
            currentSearch.results.length > 0 && (
              <div className={styles.sectionHeader}>Results</div>
            )}
          {currentSearch?.results.map((result, index) => (
            <SearchResult
              key={result.uuid ?? index}
              result={result}
              getFullMessageUrl={getFullMessageUrl}
              getFullEventUrl={getFullEventUrl}
            />
          ))}
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
