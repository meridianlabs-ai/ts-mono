import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useRef,
  useState,
} from "react";

import { ChatView } from "../../components/chat/ChatView";
import { ApplicationIcons } from "../../components/icons";
import { useApi } from "../../state/store";
import { ChatMessage, ChatMessageUser } from "../../types/api-types";
import { SidebarHeader } from "../validation/components/ValidationCaseEditor";

import styles from "./ChatPanel.module.css";

interface ChatPanelProps {
  transcriptDir: string;
  transcriptId: string;
  onClose: () => void;
}

export const ChatPanel: FC<ChatPanelProps> = ({
  transcriptDir,
  transcriptId,
  onClose,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const api = useApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

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
        .then((assistant) => {
          setMessages((prev) => [...prev, assistant]);
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
        icon={ApplicationIcons.messages}
        title="Chat"
        onClose={onClose}
      />
      <div className={styles.body}>
        <div className={styles.messages}>
          <ChatView
            messages={messages}
            toolCallStyle="complete"
            allowLinking={false}
          />
          {loading && (
            <div className={styles.loading}>Thinking...</div>
          )}
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="Send a message..."
            rows={1}
            onKeyDown={handleKeyDown}
          />
          <button
            type="submit"
            className={styles.sendButton}
            title="Send message"
            disabled={loading}
          >
            <i className={ApplicationIcons.send} />
          </button>
        </form>
      </div>
    </div>
  );
};
