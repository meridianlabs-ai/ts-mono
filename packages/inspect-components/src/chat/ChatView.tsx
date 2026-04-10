import clsx from "clsx";
import { FC } from "react";

import type { ChatMessage as ChatMessageType } from "@tsmono/inspect-common/types";

import { ChatMessageRow } from "./ChatMessageRow";
import { resolveMessages } from "./messages";
import {
  ChatViewDisplayOptions,
  ChatViewLabelOptions,
  ChatViewLinkingOptions,
  ChatViewToolOptions,
} from "./types";

export interface ChatViewProps {
  id: string;
  messages: ChatMessageType[];
  className?: string | string[];
  display?: ChatViewDisplayOptions;
  labels?: ChatViewLabelOptions;
  linking?: ChatViewLinkingOptions;
  tools?: ChatViewToolOptions;
}

/**
 * Renders the ChatView component.
 */
export const ChatView: FC<ChatViewProps> = ({
  id,
  messages,
  className,
  display,
  labels,
  linking,
  tools,
}) => {
  const resolveInto = tools?.collapseToolMessages ?? true;
  const collapsedMessages = resolveInto
    ? resolveMessages(messages)
    : messages.map((msg) => {
        return {
          message: msg,
          toolMessages: [],
        };
      });
  return (
    <div className={clsx(className)}>
      {collapsedMessages.map((msg, index) => {
        return (
          <ChatMessageRow
            index={index}
            key={`${id}-msg-${index}`}
            parentName={id || "chat-view"}
            resolvedMessage={msg}
            display={display}
            labels={labels}
            linking={linking}
            tools={tools}
          />
        );
      })}
    </div>
  );
};
