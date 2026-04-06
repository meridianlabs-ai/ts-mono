import { FC } from "react";

import type {
  ChatMessageAssistant,
  ChatMessageSystem,
  ChatMessageTool,
  ChatMessageUser,
} from "@tsmono/inspect-common/types";

import { MessageContent } from "./MessageContent";
import type { Citation } from "./types";

interface MessageContentsProps {
  message:
    | ChatMessageAssistant
    | ChatMessageSystem
    | ChatMessageUser
    | ChatMessageTool;
}

export interface MessagesContext {
  citations: Citation[];
}

export const defaultContext = (): MessagesContext => {
  return {
    citations: [],
  };
};

export const MessageContents: FC<MessageContentsProps> = ({ message }) => {
  const context: MessagesContext = defaultContext();
  return (
    <>
      {message.content && (
        <MessageContent contents={message.content} context={context} />
      )}
    </>
  );
};
