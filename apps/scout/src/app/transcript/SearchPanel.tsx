import clsx from "clsx";
import {
  ChangeEvent,
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  MarkdownDivWithReferences,
  MarkdownReference,
  SegmentedControl,
} from "@tsmono/react/components";

import { ApplicationIcons } from "../../components/icons";
import { useApi } from "../../state/store";
import { Result, SavedSearch, SearchRequest } from "../../types/api-types";
import { Chip } from "../components/Chip";
import { ChipGroup } from "../components/ChipGroup";
import { useProjectConfig } from "../server/useProjectConfig";
import { SidebarHeader } from "../validation/components/ValidationCaseEditor";

import { useTranscriptNavigation } from "./hooks/useTranscriptNavigation";
import styles from "./SearchPanel.module.css";

type SearchType = "grep" | "llm";
type PanelView = "results" | "recent";

type GrepOptions = {
  ignoreCase: boolean;
  regex: boolean;
  wordBoundary: boolean;
};

const defaultGrepOptions: GrepOptions = {
  ignoreCase: true,
  regex: false,
  wordBoundary: false,
};

type SearchPanelProps = {
  transcriptDir: string;
  transcriptId: string;
  onClose: () => void;
};

export const SearchPanel: FC<SearchPanelProps> = ({
  transcriptDir,
  transcriptId,
  onClose,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const api = useApi();
  const projectConfig = useProjectConfig();
  const [currentSearch, setCurrentSearch] = useState<SavedSearch | null>(null);
  const [recentSearches, setRecentSearches] = useState<SavedSearch[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchType, setSearchType] = useState<SearchType>("grep");
  const [panelView, setPanelView] = useState<PanelView>("recent");
  const [grepOptions, setGrepOptions] =
    useState<GrepOptions>(defaultGrepOptions);
  const [model, setModel] = useState<string>("");
  const [hasSearched, setHasSearched] = useState(false);
  const { getFullMessageUrl } = useTranscriptNavigation();

  useEffect(() => {
    void api.getSearches(transcriptDir, transcriptId).then((response) => {
      setRecentSearches(response.items);
    });
  }, [api, transcriptDir, transcriptId]);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [query, resizeTextarea]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = query.trim();
      if (!text || loading) return;

      setLoading(true);
      setHasSearched(true);
      setPanelView("results");
      setCurrentSearch(null);

      const request: SearchRequest =
        searchType === "grep"
          ? {
              ignore_case: grepOptions.ignoreCase,
              query: text,
              regex: grepOptions.regex,
              type: "grep",
              word_boundary: grepOptions.wordBoundary,
            }
          : {
              query: text,
              type: "llm",
              model: model.trim() || projectConfig.data?.config.model || null,
            };

      void api
        .postSearch(transcriptDir, transcriptId, request)
        .then((saved) => {
          setCurrentSearch(saved);
          // Update recent searches: replace if same search_id, otherwise prepend
          setRecentSearches((prev) => {
            const filtered = prev.filter(
              (s) => s.search_id !== saved.search_id
            );
            return [saved, ...filtered];
          });
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [
      api,
      transcriptDir,
      transcriptId,
      grepOptions.ignoreCase,
      grepOptions.regex,
      grepOptions.wordBoundary,
      searchType,
      loading,
      model,
      projectConfig.data?.config.model,
      query,
    ]
  );

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      textareaRef.current?.form?.requestSubmit();
    }
  }, []);

  const handleSelectRecent = useCallback((search: SavedSearch) => {
    setCurrentSearch(search);
    setHasSearched(true);
    setQuery(search.query);
    setSearchType(search.type);
    setPanelView("results");
    if (search.type === "llm") {
      setModel(search.model ?? "");
    } else {
      setGrepOptions({
        ignoreCase: search.ignore_case,
        regex: search.regex,
        wordBoundary: search.word_boundary,
      });
    }
  }, []);

  const toggleGrepOption = useCallback((key: keyof GrepOptions) => {
    setGrepOptions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const handleSearchTypeChange = useCallback((type: SearchType) => {
    setSearchType(type);
  }, []);

  const handleQueryChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setQuery(e.target.value);
    },
    []
  );

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
          <div className={styles.inputShell}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder={
                searchType === "grep"
                  ? "Search for text..."
                  : "Ask a question about this transcript..."
              }
              value={query}
              rows={4}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className={styles.controlsRow}>
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
                    onChange={(e) => setModel(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
          <div className={styles.footerRow}>
            <button
              type="button"
              className={clsx(
                styles.footerAction,
                showRecentSearches && styles.footerActionActive
              )}
              onClick={() => setPanelView("recent")}
            >
              Recent
            </button>
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
          {showResults && !loading && hasSearched && currentSearch === null && (
            <div className={styles.emptyState}>No results found</div>
          )}
          {showResults &&
            !loading &&
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
          {showResults && !loading && !hasSearched && (
            <div className={styles.emptyState}>
              Run a search or open a recent query.
            </div>
          )}
          {showRecentSearches && recentSearches.length > 0 && (
            <RecentSearches
              searches={recentSearches}
              onSelect={handleSelectRecent}
            />
          )}
          {showRecentSearches && recentSearches.length === 0 && (
            <div className={styles.emptyState}>
              Recent searches will show up here.
            </div>
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
  searches: SavedSearch[];
  onSelect: (search: SavedSearch) => void;
}> = ({ searches, onSelect }) => (
  <div className={styles.recentSearches}>
    <div className={styles.sectionHeader}>Recent searches</div>
    {searches.map((search) => (
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
