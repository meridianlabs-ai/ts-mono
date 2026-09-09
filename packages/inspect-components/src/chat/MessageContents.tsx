import { FC } from "react";

import type {
  ChatMessageAssistant,
  ChatMessageSystem,
  ChatMessageTool,
  ChatMessageUser,
} from "@tsmono/inspect-common/types";
import type { MarkdownReference } from "@tsmono/react/components";

import { MessageContent } from "./MessageContent";

interface MessageContentsProps {
  message:
    | ChatMessageAssistant
    | ChatMessageSystem
    | ChatMessageUser
    | ChatMessageTool;
  references?: MarkdownReference[];
}

export const MessageContents: FC<MessageContentsProps> = ({
  message,
  references,
}) => {
  return (
    <>
      {message.content && (
        <MessageContent contents={message.content} references={references} />
      )}
    </>
  );
};
