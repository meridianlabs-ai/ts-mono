import clsx from "clsx";
import { FC, memo, ReactNode, useState } from "react";

import type { ContentImage, ContentText } from "@tsmono/inspect-common/types";
import {
  CopyButton,
  ExpandablePanel,
  LabeledValue,
  MarkdownDiv,
  type MarkdownReference,
} from "@tsmono/react/components";

import { RecordTree } from "../content/RecordTree";

import styles from "./ChatMessage.module.css";
import { MessageContents } from "./MessageContents";
import { Message } from "./messages";
import {
  codexToolMarkdown,
  formatSubagentNotifications,
  parseToolSearchCatalog,
  type ToolSearchNamespaceEntry,
} from "./tools/tool";
import { ToolOutput } from "./tools/ToolOutput";
import { ToolSearchView } from "./tools/ToolSearchView";
import { ChatViewDisplayOptions, ChatViewLinkingOptions } from "./types";

interface ChatMessageProps {
  id: string;
  message: Message;
  display?: ChatViewDisplayOptions;
  linking?: ChatViewLinkingOptions;
  references?: MarkdownReference[];
  /** Optional position-label chip, rendered at the far right of the role line. */
  label?: ReactNode;
}

export const ChatMessage: FC<ChatMessageProps> = memo(function ChatMessage({
  id,
  message,
  display,
  linking,
  references,
  label,
}) {
  const indented = display?.indented ?? false;
  const unlabeledRoles = display?.unlabeledRoles;
  const formatDateTime = display?.formatDateTime;
  const linkingEnabled = linking?.enabled ?? false;
  const getMessageUrl = linking?.getMessageUrl;
  const linkIcon = linking?.icon ?? "bi bi-link-45deg";

  const messageUrl = getMessageUrl?.(message.id || "");

  const [mouseOver, setMouseOver] = useState(false);

  const isNonSubagentTool =
    message.role === "tool" &&
    message.function !== "Task" &&
    message.function !== "task" &&
    message.function !== "Agent" &&
    message.function !== "agent";
  const collapse =
    message.role === "system" ||
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "tool";
  const hideRole = unlabeledRoles?.includes(message.role) ?? false;

  // Codex tool results get friendlier rendering than the raw JSON/text dump:
  // tool_search → a collapsible catalog component; sub-agent management answers
  // → markdown. The raw content stays available in the JSON tab.
  let toolSearchNamespaces: ToolSearchNamespaceEntry[] | undefined;
  let toolMarkdown: string | undefined;
  if (isNonSubagentTool && message.role === "tool" && message.function) {
    if (message.function === "tool_search") {
      toolSearchNamespaces = parseToolSearchCatalog(message.content);
    } else {
      toolMarkdown = codexToolMarkdown(message.function, message.content);
    }
  }

  // Codex sub-agent completion notifications (user messages) collapse to a
  // compact status line — the answer itself is shown by the paired wait/close
  // result; the raw notification stays in the JSON tab.
  const subagentNotifications =
    message.role === "user"
      ? formatSubagentNotifications(message.content)
      : undefined;

  // When the role header is hidden, skip rendering if there's no visible
  // text content (e.g. assistant messages with only tool_calls).
  if (hideRole) {
    const content = message.content;
    const hasVisibleContent =
      typeof content === "string"
        ? content.trim().length > 0
        : Array.isArray(content) && content.some((c) => c.type !== "tool_use");
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
      data-message-id={message.id || undefined}
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
            {message.role === "tool"
              ? message.function
                ? `: ${message.function}`
                : ""
              : ""}
            {linkingEnabled && messageUrl ? (
              <CopyButton
                icon={linkIcon}
                value={messageUrl}
                className={clsx(styles.copyLink)}
              />
            ) : (
              ""
            )}
          </div>
          {(message.timestamp && formatDateTime) || label ? (
            <div className={styles.headerEnd}>
              {message.timestamp && formatDateTime && (
                <span className={styles.timestamp} title={message.timestamp}>
                  {formatDateTime(new Date(message.timestamp))}
                </span>
              )}
              {label}
            </div>
          ) : null}
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
          lines={
            message.role === "tool"
              ? 30
              : message.role === "assistant"
                ? 25
                : collapse
                  ? 15
                  : 25
          }
        >
          {isNonSubagentTool ? (
            toolSearchNamespaces ? (
              <ToolSearchView namespaces={toolSearchNamespaces} />
            ) : toolMarkdown !== undefined ? (
              <MarkdownDiv markdown={toolMarkdown} />
            ) : (
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
            )
          ) : subagentNotifications !== undefined ? (
            <MarkdownDiv markdown={subagentNotifications} />
          ) : (
            <MessageContents
              key={`${id}-contents`}
              message={message}
              references={references}
            />
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
});
