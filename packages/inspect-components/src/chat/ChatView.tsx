import clsx from "clsx";
import { FC, useMemo } from "react";

import type { ChatMessage as ChatMessageType } from "@tsmono/inspect-common/types";
import type { MarkdownReference } from "@tsmono/react/components";

import { ChatMessageRow } from "./ChatMessageRow";
import { computeMaxLabelLength } from "./labelLength";
import { buildMessageRows, messageRowOptions } from "./rowsModel";
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
  references?: MarkdownReference[];
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
  references,
}) => {
  const callStyle = tools?.callStyle;
  const collapseToolMessages = tools?.collapseToolMessages;
  const rows = useMemo(
    () =>
      buildMessageRows(
        messages,
        messageRowOptions({ callStyle, collapseToolMessages })
      ),
    [messages, callStyle, collapseToolMessages]
  );
  const maxLabelLength = useMemo(
    () => computeMaxLabelLength(labels?.messageLabels),
    [labels?.messageLabels]
  );
  return (
    <div className={clsx(className)}>
      {rows.map((row, index) => {
        return (
          <ChatMessageRow
            index={index}
            key={`${id}-msg-${index}`}
            parentName={id || "chat-view"}
            resolvedMessage={row.resolved}
            display={display}
            labels={labels}
            linking={linking}
            tools={tools}
            maxLabelLength={maxLabelLength}
            startNumber={row.startNumber}
            references={references}
          />
        );
      })}
    </div>
  );
};
