import clsx from "clsx";
import { FC } from "react";

import type { ChatMessage as ChatMessageType } from "@tsmono/inspect-common/types";

import { ChatMessageRow } from "./ChatMessageRow";
import { resolveMessages } from "./messages";
import type { ToolCallViewProps } from "./tools/ToolCallView";
import { ChatViewToolCallStyle } from "./types";

export interface ChatViewProps {
  id?: string;
  messages: ChatMessageType[];
  toolCallStyle?: ChatViewToolCallStyle;
  resolveToolCallsIntoPreviousMessage?: boolean;
  title?: string;
  indented?: boolean;
  className?: string | string[];
  allowLinking?: boolean;
  labels?: Record<string, string>;
  showLabels?: boolean;
  highlightLabeled?: boolean;
  unlabeledRoles?: string[];
  getMessageUrl?: (messageId: string) => string | undefined;
  supportsLinking?: () => boolean;
  formatDateTime?: (date: Date) => string;
  linkIcon?: string;
  getCustomToolView?: (props: ToolCallViewProps) => React.ReactNode | undefined;
}

/**
 * Renders the ChatView component.
 */
export const ChatView: FC<ChatViewProps> = ({
  id,
  messages,
  toolCallStyle = "complete",
  resolveToolCallsIntoPreviousMessage = true,
  indented,
  labels,
  showLabels = true,
  highlightLabeled = false,
  className,
  allowLinking = true,
  unlabeledRoles,
  getMessageUrl,
  supportsLinking,
  formatDateTime,
  linkIcon,
  getCustomToolView,
}) => {
  const collapsedMessages = resolveToolCallsIntoPreviousMessage
    ? resolveMessages(messages)
    : messages.map((msg) => {
        return {
          message: msg,
          toolMessages: [],
        };
      });
  const result = (
    <div className={clsx(className)}>
      {collapsedMessages.map((msg, index) => {
        return (
          <ChatMessageRow
            index={index}
            key={`${id}-msg-${index}`}
            parentName={id || "chat-view"}
            showLabels={showLabels}
            labels={labels}
            highlightLabeled={highlightLabeled}
            resolvedMessage={msg}
            indented={indented}
            toolCallStyle={toolCallStyle}
            allowLinking={allowLinking}
            unlabeledRoles={unlabeledRoles}
            getMessageUrl={getMessageUrl}
            supportsLinking={supportsLinking}
            formatDateTime={formatDateTime}
            linkIcon={linkIcon}
            getCustomToolView={getCustomToolView}
          />
        );
      })}
    </div>
  );
  return result;
};
