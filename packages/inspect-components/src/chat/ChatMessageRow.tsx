import clsx from "clsx";
import { FC, Fragment, ReactNode } from "react";

import type { ChatMessageTool } from "@tsmono/inspect-common/types";

import { ChatMessage } from "./ChatMessage";
import styles from "./ChatMessageRow.module.css";
import { ResolvedMessage } from "./messages";
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
  highlightUserMessage?: boolean;
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
  highlightUserMessage,
  className,
  display,
  labels,
  linking,
  tools,
  maxLabelLength,
}) => {
  const showLabels = labels?.show ?? true;
  const labelValues = labels?.messageLabels;
  const highlightLabeled = labels?.highlight ?? false;
  const toolCallStyle = tools?.callStyle ?? "complete";
  const getCustomToolView = tools?.renderToolCall;

  const views: ReactNode[] = [];
  const viewLabels: Array<string | undefined> = [];
  const useLabels = showLabels || Object.keys(labelValues || {}).length > 0;

  if (useLabels) {
    // The chat message and label
    const number = index + 1;
    const maxlabelLen = maxLabelLength ?? 3;
    const chatMessageLabel =
      labelValues && resolvedMessage.message.id
        ? labelValues[resolvedMessage.message.id] ||
          "\u00A0".repeat(maxlabelLen * 2)
        : String(number) || undefined;
    viewLabels.push(chatMessageLabel);
  }

  // The chat message
  views.push(
    <ChatMessage
      id={`${parentName}-chat-messages`}
      message={resolvedMessage.message}
      display={display}
      linking={linking}
    />
  );

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

      // The label (if any)
      const toolLabel = labelValues?.[toolMessage?.id || ""] || undefined;

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
