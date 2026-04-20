import clsx from "clsx";
import { FC, Fragment, ReactNode } from "react";

import type { ChatMessageTool } from "@tsmono/inspect-common/types";

import { ChatMessage } from "./ChatMessage";
import styles from "./ChatMessageRow.module.css";
import { Message, ResolvedMessage } from "./messages";
import { resolveToolInput, substituteToolCallContent } from "./tools/tool";
import { ToolCallView } from "./tools/ToolCallView";
import {
  ChatViewDisplayOptions,
  ChatViewLabelOptions,
  ChatViewLinkingOptions,
  ChatViewToolOptions,
  ContentTool,
} from "./types";

interface ChatMessageRowProps {
  index: number;
  parentName: string;
  resolvedMessage: ResolvedMessage;
  className?: string | string[];
  display?: ChatViewDisplayOptions;
  labels?: ChatViewLabelOptions;
  linking?: ChatViewLinkingOptions;
  tools?: ChatViewToolOptions;
  maxLabelLength?: number;
}

/**
 * Renders the ChatMessage component.
 */
export const ChatMessageRow: FC<ChatMessageRowProps> = ({
  index,
  parentName,
  resolvedMessage,
  className,
  display,
  labels,
  linking,
  tools,
  maxLabelLength,
}) => {
  const highlightUserMessage = display?.highlightUserMessage ?? true;
  const showLabels = labels?.show ?? true;
  const labelValues = labels?.messageLabels;
  const highlightLabeled = labels?.highlight ?? false;
  const toolCallStyle = tools?.callStyle ?? "complete";
  const getCustomToolView = tools?.renderToolCall;

  const views: ReactNode[] = [];
  const viewLabels: Array<string | undefined> = [];
  const useLabels = showLabels || Object.keys(labelValues || {}).length > 0;

  const hasToolCalls =
    toolCallStyle !== "omit" &&
    resolvedMessage.message.role === "assistant" &&
    !!resolvedMessage.message.tool_calls &&
    resolvedMessage.message.tool_calls.length > 0;

  // Skip the assistant chat message entirely when it has no visible text
  // or reasoning content and the tool calls will be rendered as their own
  // views below — otherwise it leaves an empty, padded block. The row label
  // (if any) gets hoisted onto the first tool call below.
  const skipChatMessage =
    hasToolCalls && !hasVisibleContent(resolvedMessage.message);

  const rowLabel = useLabels
    ? (() => {
        const number = index + 1;
        const maxlabelLen = maxLabelLength ?? 3;
        return labelValues && resolvedMessage.message.id
          ? labelValues[resolvedMessage.message.id] ||
              "\u00A0".repeat(maxlabelLen * 2)
          : String(number) || undefined;
      })()
    : undefined;

  if (!skipChatMessage) {
    if (useLabels) {
      viewLabels.push(rowLabel);
    }

    views.push(
      <ChatMessage
        id={`${parentName}-chat-messages-${index}`}
        message={resolvedMessage.message}
        display={display}
        linking={linking}
      />
    );
  }

  // The tool messages associated with this chat message
  if (
    toolCallStyle !== "omit" &&
    resolvedMessage.message.role === "assistant" &&
    resolvedMessage.message.tool_calls &&
    resolvedMessage.message.tool_calls.length
  ) {
    const toolMessages = resolvedMessage.toolMessages || [];
    let idx = 0;
    for (const tool_call of resolvedMessage.message.tool_calls) {
      // Extract tool input
      const { name, input, description, functionCall, contentType } =
        resolveToolInput(tool_call.function, tool_call.arguments);

      let toolMessage: ChatMessageTool | undefined;
      if (tool_call.id) {
        toolMessage = toolMessages.find((msg) => {
          return msg.tool_call_id === tool_call.id;
        });
      } else {
        toolMessage = toolMessages[idx];
      }

      // The label (if any). When we've skipped the assistant chat message,
      // hoist its numeric/row label onto the first tool call so the row
      // isn't left unlabeled.
      const toolLabel =
        labelValues?.[toolMessage?.id || ""] ||
        (skipChatMessage && idx === 0 ? rowLabel : undefined);

      // Resolve the tool output
      const resolvedToolOutput = resolveToolMessage(toolMessage);
      if (useLabels) {
        viewLabels.push(toolLabel);
      }

      if (toolCallStyle === "compact") {
        views.push(
          <ToolCallViewCompact idx={idx} functionCall={functionCall} />
        );
      } else {
        views.push(
          <ToolCallView
            id={`${index}-tool-call-${idx}`}
            key={`tool-call-${idx}`}
            tool={name}
            functionCall={functionCall}
            input={input}
            description={description}
            contentType={contentType}
            output={resolvedToolOutput}
            view={
              tool_call.view
                ? substituteToolCallContent(
                    tool_call.view,
                    tool_call.arguments as Record<string, unknown>
                  )
                : undefined
            }
            getCustomToolView={getCustomToolView}
          />
        );
      }
      idx++;
    }
  }

  if (useLabels) {
    return (
      <>
        <div className={clsx(styles.grid, className)}>
          {views.map((view, idx) => {
            const label = viewLabels[idx];
            return (
              <Fragment key={`chat-message-row-${index}-part-${idx}`}>
                <div
                  className={clsx(
                    "text-size-smaller",
                    "text-style-secondary",
                    styles.number,
                    styles.label
                  )}
                >
                  {label}
                </div>
                <div
                  className={clsx(
                    styles.container,
                    highlightUserMessage &&
                      resolvedMessage.message.role === "user"
                      ? styles.user
                      : undefined,
                    idx === 0 ? styles.first : undefined,
                    idx === views.length - 1 ? styles.last : undefined,
                    highlightLabeled && label?.trim()
                      ? styles.highlight
                      : undefined
                  )}
                >
                  {view}
                </div>
              </Fragment>
            );
          })}
        </div>
      </>
    );
  } else {
    return views.map((view, idx) => {
      return (
        <div
          key={`chat-message-row-unlabeled-${index}-part-${idx}`}
          className={clsx(
            styles.container,
            idx === 0 ? styles.first : undefined,
            idx === views.length - 1 ? styles.last : undefined,
            idx === views.length - 1 ? styles.bottomMargin : undefined,
            className,
            styles.simple,
            highlightUserMessage && resolvedMessage.message.role === "user"
              ? styles.user
              : undefined
          )}
        >
          {view}
        </div>
      );
    });
  }
};

const resolveToolMessage = (toolMessage?: ChatMessageTool): ContentTool[] => {
  if (!toolMessage) {
    return [];
  }

  const content =
    toolMessage.error !== null && toolMessage.error
      ? toolMessage.error.message
      : toolMessage.content;
  if (typeof content === "string") {
    return [
      {
        type: "tool",
        content: [
          {
            type: "text",
            text: content,
            refusal: null,
            internal: null,
            citations: null,
          },
        ],
      },
    ];
  } else {
    const result = content
      .map((con) => {
        if (typeof con === "string") {
          return {
            type: "tool",
            content: [
              {
                type: "text",
                text: con,
                refusal: null,
                internal: null,
                citations: null,
              },
            ],
          } as ContentTool;
        } else if (con.type !== "tool_use") {
          return {
            content: [con],
            type: "tool",
          } as ContentTool;
        }
      })
      .filter((con) => con !== undefined);
    return result;
  }
};

const hasVisibleContent = (message: Message): boolean => {
  const content = message.content;
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((c) => {
    if (c.type === "tool_use") {
      return false;
    }
    if (c.type === "text") {
      const hasText = c.text.trim().length > 0;
      const hasCitations = !!c.citations && c.citations.length > 0;
      return hasText || hasCitations;
    }
    if (c.type === "reasoning") {
      const hasReasoning = c.reasoning.trim().length > 0;
      const hasSummary = (c.summary?.trim().length ?? 0) > 0;
      return hasReasoning || hasSummary || !!c.redacted;
    }
    return true;
  });
};

const ToolCallViewCompact: FC<{
  idx: number;
  functionCall: string;
}> = ({ idx, functionCall }) => {
  return (
    <div key={`tool-call-${idx}`}>
      <code className={clsx(styles.codeCompact)}>tool: {functionCall}</code>
    </div>
  );
};
