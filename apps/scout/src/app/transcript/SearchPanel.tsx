import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import { ChatView } from "../../components/chat/ChatView";
import { ApplicationIcons } from "../../components/icons";
import { MarkdownReference } from "../../components/MarkdownDivWithReferences";
import { useApi } from "../../state/store";
import { ChatMessage, ChatMessageUser, Reference } from "../../types/api-types";
import { SidebarHeader } from "../validation/components/ValidationCaseEditor";

import { useTranscriptNavigation } from "./hooks/useTranscriptNavigation";
import styles from "./SearchPanel.module.css";

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const { getFullMessageUrl } = useTranscriptNavigation();

  const markdownRefs = useMemo((): MarkdownReference[] => {
    const seen = new Set<string>();
    const refs: MarkdownReference[] = [];
    for (const ref of references) {
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
  }, [references, getFullMessageUrl]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const text = textarea.value.trim();
      if (!text || loading) return;
      textarea.value = "";

      const userMessage: ChatMessageUser = {
        role: "user",
        content: text,
        id: null,
        metadata: null,
        source: null,
        tool_call_id: null,
      };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setLoading(true);

      void api
        .postChat({
          transcript_dir: transcriptDir,
          transcript_id: transcriptId,
          messages: updatedMessages,
        })
        .then((response) => {
          setMessages((prev) => [...prev, response.message]);
          setReferences((prev) => [...prev, ...response.references]);
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [api, transcriptDir, transcriptId, messages, loading]
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
        <form className={styles.form} onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="Search this transcript..."
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
        <div className={styles.results}>
          <ChatView
            messages={messages}
            toolCallStyle="complete"
            references={markdownRefs}
          />
          {loading && <div className={styles.loading}>Searching...</div>}
        </div>
      </div>
    </div>
  );
};
