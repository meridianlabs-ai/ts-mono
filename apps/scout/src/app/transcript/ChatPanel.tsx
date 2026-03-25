import { FC, FormEvent, KeyboardEvent, useCallback, useRef } from "react";

import { ApplicationIcons } from "../../components/icons";
import { SidebarHeader } from "../validation/components/ValidationCaseEditor";

import styles from "./ChatPanel.module.css";

interface ChatPanelProps {
  onClose: () => void;
}

export const ChatPanel: FC<ChatPanelProps> = ({ onClose }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) return;
    alert(text);
    textarea.value = "";
  }, []);

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
        <div className={styles.messages} />
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
        >
          <i className={ApplicationIcons.send} />
        </button>
        </form>
      </div>
    </div>
  );
};
