import { FC } from "react";

import {
  ChatMessageAssistant,
  ChatMessageSystem,
  ChatMessageTool,
  ChatMessageUser,
} from "../../types/api-types";
import { MarkdownReference } from "../MarkdownDivWithReferences";

import { MessageContent } from "./MessageContent";
import { Citation } from "./types";

interface MessageContentsProps {
  message:
    | ChatMessageAssistant
    | ChatMessageSystem
    | ChatMessageUser
    | ChatMessageTool;
  references?: MarkdownReference[];
}

export interface MessagesContext {
  citations: Citation[];
}

export const defaultContext = () => {
  return {
    citeOffset: 0,
    citations: [],
  };
};

export const MessageContents: FC<MessageContentsProps> = ({ message, references }) => {
  const context: MessagesContext = defaultContext();
  return (
    <>
      {message.content && (
        <MessageContent contents={message.content} context={context} references={references} />
      )}
    </>
  );
};
