import clsx from "clsx";
import { FC, memo, useState } from "react";

import type {
  ChatMessageTool,
  ContentImage,
  ContentText,
} from "@tsmono/inspect-common/types";
import { RecordTree } from "../content/RecordTree";
import {
  CopyButton,
  ExpandablePanel,
  LabeledValue,
} from "@tsmono/react/components";

import styles from "./ChatMessage.module.css";
import { Message } from "./messages";
import { MessageContents } from "./MessageContents";
import { ToolOutput } from "./tools/ToolOutput";
import { ChatViewToolCallStyle } from "./types";

interface ChatMessageProps {
  id: string;
  message: Message;
  toolMessages: ChatMessageTool[];
  indented?: boolean;
  toolCallStyle: ChatViewToolCallStyle;
  allowLinking?: boolean;
  unlabeledRoles?: string[];
  getMessageUrl?: (messageId: string) => string | undefined;
  supportsLinking?: () => boolean;
  formatDateTime?: (date: Date) => string;
  linkIcon?: string;
}

export const ChatMessage: FC<ChatMessageProps> = memo(
  ({
    id,
    message,
    indented,
    allowLinking = true,
    unlabeledRoles,
    getMessageUrl,
    supportsLinking,
    formatDateTime,
    linkIcon = "bi bi-link-45deg",
  }) => {
    const messageUrl = getMessageUrl?.(message.id || "");
    const canLink = supportsLinking?.() ?? !!messageUrl;

    const [mouseOver, setMouseOver] = useState(false);

    const isNonTaskTool =
      message.role === "tool" && message.function !== "Task";
    const collapse =
      message.role === "system" || message.role === "user";
    const hideRole = unlabeledRoles?.includes(message.role) ?? false;

    // When the role header is hidden, skip rendering if there's no visible
    // text content (e.g. assistant messages with only tool_calls).
    if (hideRole) {
      const content = message.content;
      const hasVisibleContent =
        typeof content === "string"
          ? content.trim().length > 0
          : Array.isArray(content) &&
            content.some((c) => c.type !== "tool_use");
      const hasToolCalls =
        "tool_calls" in message &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0;
      if (!hasVisibleContent && !hasToolCalls) {
        return null;
      }
    }

    return (
      <div
        className={clsx(
          message.role,
          "text-size-base",
          styles.message,
          message.role === "system" ? styles.systemRole : undefined,
          message.role === "user" ? styles.userRole : undefined,
          mouseOver ? styles.hover : undefined
        )}
        onMouseEnter={() => setMouseOver(true)}
        onMouseLeave={() => setMouseOver(false)}
      >
        {!hideRole && (
          <div
            className={clsx(
              styles.messageGrid,
              message.role === "tool" ? styles.toolMessageGrid : undefined,
              "text-style-label"
            )}
          >
            <div>
              {message.role}
              {message.role === "tool" ? `: ${message.function}` : ""}
              {canLink && messageUrl && allowLinking ? (
                <CopyButton
                  icon={linkIcon}
                  value={messageUrl}
                  className={clsx(styles.copyLink)}
                />
              ) : (
                ""
              )}
            </div>
            {message.timestamp && formatDateTime && (
              <span className={styles.timestamp} title={message.timestamp}>
                {formatDateTime(new Date(message.timestamp))}
              </span>
            )}
          </div>
        )}
        <div
          className={clsx(
            styles.messageContents,
            indented ? styles.indented : undefined
          )}
        >
          <ExpandablePanel
            id={`${id}-message`}
            collapse={collapse}
            lines={collapse ? 15 : 25}
          >
            {isNonTaskTool ? (
              <ToolOutput
                output={
                  typeof message.content === "string"
                    ? message.content
                    : message.content.filter(
                        (c): c is ContentText | ContentImage =>
                          c.type === "text" || c.type === "image"
                      )
                }
              />
            ) : (
              <MessageContents key={`${id}-contents`} message={message} />
            )}
          </ExpandablePanel>

          {message.metadata && Object.keys(message.metadata).length > 0 ? (
            <LabeledValue
              label="Metadata"
              className={clsx(styles.metadataLabel, "text-size-smaller")}
            >
              <RecordTree
                record={message.metadata}
                id={`${id}-metadata`}
                defaultExpandLevel={0}
              />
            </LabeledValue>
          ) : (
            ""
          )}
        </div>
      </div>
    );
  }
);
