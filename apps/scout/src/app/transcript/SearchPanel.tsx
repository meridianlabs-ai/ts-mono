import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApplicationIcons } from "../../components/icons";
import {
  MarkdownDivWithReferences,
  MarkdownReference,
} from "../../components/MarkdownDivWithReferences";
import { useApi } from "../../state/store";
import { Result } from "../../types/api-types";
import { SidebarHeader } from "../validation/components/ValidationCaseEditor";

import { useTranscriptNavigation } from "./hooks/useTranscriptNavigation";
import styles from "./SearchPanel.module.css";

type SearchType = "grep" | "llm";

interface SearchPanelProps {
  transcriptDir: string;
  transcriptId: string;
  onClose: () => void;
}

export const SearchPanel: FC<SearchPanelProps> = ({
  transcriptDir,
  transcriptId,
  onClose,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const api = useApi();
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchType, setSearchType] = useState<SearchType>("grep");
  const [hasSearched, setHasSearched] = useState(false);
  const { getFullMessageUrl } = useTranscriptNavigation();

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const text = textarea.value.trim();
      if (!text || loading) return;

      setLoading(true);
      setHasSearched(true);

      void api
        .postSearch({
          transcript_dir: transcriptDir,
          transcript_id: transcriptId,
          query: text,
          type: searchType,
        })
        .then((response) => {
          setResults(response.results);
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [api, transcriptDir, transcriptId, searchType, loading]
  );

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      textareaRef.current?.form?.requestSubmit();
    }
  }, []);

  return (
    <div className={styles.container}>
      <SidebarHeader
        icon={ApplicationIcons.search}
        title="Search"
        onClose={onClose}
      />
      <div className={styles.body}>
        <div className={styles.searchArea}>
          <div className={styles.typeToggle}>
            <button
              type="button"
              className={
                searchType === "grep"
                  ? styles.typeButtonActive
                  : styles.typeButton
              }
              onClick={() => setSearchType("grep")}
            >
              Grep
            </button>
            <button
              type="button"
              className={
                searchType === "llm"
                  ? styles.typeButtonActive
                  : styles.typeButton
              }
              onClick={() => setSearchType("llm")}
            >
              LLM
            </button>
          </div>
          <form className={styles.form} onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder={
                searchType === "grep"
                  ? "Search for text..."
                  : "Ask a question about this transcript..."
              }
              rows={1}
              onKeyDown={handleKeyDown}
            />
            <button
              type="submit"
              className={styles.searchButton}
              title="Search"
              disabled={loading}
            >
              <i className={ApplicationIcons.search} />
            </button>
          </form>
        </div>
        <div className={styles.results}>
          {loading && <div className={styles.loading}>Searching...</div>}
          {!loading && hasSearched && results.length === 0 && (
            <div className={styles.noResults}>No results found</div>
          )}
          {results.map((result, index) => (
            <SearchResult
              key={result.uuid ?? index}
              result={result}
              getFullMessageUrl={getFullMessageUrl}
            />
          ))}
        </div>
      </div>
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
