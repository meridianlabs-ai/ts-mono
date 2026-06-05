import clsx from "clsx";
import { FC, memo, ReactNode } from "react";

import type { ChatMessageTool } from "@tsmono/inspect-common/types";
import type { MarkdownReference } from "@tsmono/react/components";

import { ChatMessage } from "./ChatMessage";
import styles from "./ChatMessageRow.module.css";
import { MessageLabel } from "./MessageLabel";
import { Message, ResolvedMessage } from "./messages";
import { resolveToolInput, substituteToolCallContent } from "./tools/tool";
import { ToolCallErrorView } from "./tools/ToolCallErrorView";
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
  references?: MarkdownReference[];
  className?: string | string[];
  display?: ChatViewDisplayOptions;
  labels?: ChatViewLabelOptions;
  linking?: ChatViewLinkingOptions;
  tools?: ChatViewToolOptions;
  maxLabelLength?: number;
  /** Global sequential number of this row's first rendered block. */
  startNumber?: number;
}

/**
 * Renders the ChatMessage component.
 */
export const ChatMessageRow = memo(function ChatMessageRow({
  index,
  parentName,
  resolvedMessage,
  references,
  className,
  display,
  labels,
  linking,
  tools,
  startNumber,
}: ChatMessageRowProps) {
  const highlightUserMessage = display?.highlightUserMessage ?? true;
  const showLabels = labels?.show ?? true;
  const labelValues = labels?.messageLabels;
  const highlightLabeled = labels?.highlight ?? false;
  const toolCallStyle = tools?.callStyle ?? "complete";
  const getCustomToolView = tools?.renderToolCall;

  const views: ReactNode[] = [];
  const viewKinds: Array<"message" | "tool" | "tool-result"> = [];
  const viewChips: Array<ReactNode | undefined> = [];
  const useLabels = showLabels || Object.keys(labelValues || {}).length > 0;

  // A block's label is its scanner citation (keyed by message id) when a label
  // map is supplied, otherwise its global sequential number. Tools carry their
  // own number but inherit the parent message's citation.
  const baseNumber = startNumber ?? index + 1;
  const labelForBlock = (
    blockId: string | null | undefined,
    blockNumber: number
  ): string | undefined =>
    labelValues && blockId ? labelValues[blockId] : String(blockNumber);

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

  // The message occupies the first block number of the row (when rendered);
  // its tool calls take the numbers that follow.
  const rowLabel = useLabels
    ? labelForBlock(resolvedMessage.message.id, baseNumber)
    : undefined;

  // The position label renders as a chip on the right of the message's role
  // line (inside the card), not as a separate column.
  const messageChip =
    !skipChatMessage && rowLabel?.trim() ? (
      <MessageLabel label={rowLabel} />
    ) : undefined;

  if (!skipChatMessage) {
    views.push(
      <ChatMessage
        id={`${parentName}-chat-messages-${index}`}
        message={resolvedMessage.message}
        display={display}
        linking={linking}
        references={references}
        label={messageChip}
      />
    );
    viewKinds.push("message");
    viewChips.push(undefined);
  }

  // The first tool's number follows the message block (if rendered).
  let toolNumber = baseNumber + (skipChatMessage ? 0 : 1);

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
        toolMessage = toolMessages.find(
          (msg) => msg.tool_call_id === tool_call.id
        );
      } else {
        toolMessage = toolMessages[idx];
      }

      // Resolve the tool output
      const resolvedToolOutput = resolveToolMessage(toolMessage);

      const resolvedToolView = tool_call.view
        ? substituteToolCallContent(tool_call.view, tool_call.arguments)
        : undefined;

      // The call (title + input) is one peer block; its output (or error) is a
      // separate peer block beneath it. Compact mode keeps the single line.
      if (toolCallStyle === "compact") {
        views.push(
          <ToolCallViewCompact idx={idx} functionCall={functionCall} />
        );
        viewKinds.push("tool");
        viewChips.push(undefined);
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
            view={resolvedToolView}
            section="call"
            getCustomToolView={getCustomToolView}
          />
        );
        viewKinds.push("tool");
        // The position chip sits on the call (the blue tool box). Tools inherit
        // the parent message's citation when a label map is supplied.
        const toolLabel = useLabels
          ? labelForBlock(resolvedMessage.message.id, toolNumber)
          : undefined;
        viewChips.push(
          toolLabel?.trim() ? <MessageLabel label={toolLabel} /> : undefined
        );

        if (toolMessage?.error) {
          views.push(
            <ToolCallErrorView
              key={`tool-call-${idx}-error`}
              error={toolMessage.error}
            />
          );
          viewKinds.push("tool-result");
          viewChips.push(undefined);
        } else if (hasOutputContent(resolvedToolOutput)) {
          views.push(
            <ToolCallView
              id={`${index}-tool-call-${idx}`}
              key={`tool-call-${idx}-output`}
              tool={name}
              functionCall={functionCall}
              input={input}
              description={description}
              contentType={contentType}
              output={resolvedToolOutput}
              view={resolvedToolView}
              section="output"
              getCustomToolView={getCustomToolView}
            />
          );
          viewKinds.push("tool-result");
          viewChips.push(undefined);
        }
      }
      toolNumber++;

      idx++;
    }
  }

  if (useLabels) {
    // Each row part is a peer block: the message in its role band, the tool
    // call in the blue tool box, and the tool output in a plain bordered box.
    const hasTools = viewKinds.some((k) => k !== "message");

    const renderPart = (
      idx: number,
      attached?: { top?: boolean; bottom?: boolean }
    ) => {
      const kind = viewKinds[idx];
      const isMessage = kind === "message";
      const chip = viewChips[idx];
      return (
        <div
          key={`chat-message-row-${index}-part-${idx}`}
          data-message-role={
            isMessage ? resolvedMessage.message.role : undefined
          }
          data-message-kind={kind}
          className={clsx(
            isMessage && styles.container,
            hasTools ? styles.box : undefined,
            isMessage &&
              highlightUserMessage &&
              resolvedMessage.message.role === "user"
              ? styles.user
              : undefined,
            isMessage && !hasTools && idx === 0 ? styles.first : undefined,
            isMessage && !hasTools && idx === views.length - 1
              ? styles.last
              : undefined,
            attached?.bottom ? styles.attachedBottom : undefined,
            attached?.top ? styles.attachedTop : undefined,
            highlightLabeled && isMessage && messageChip
              ? styles.highlight
              : undefined
          )}
        >
          {chip ? <div className={styles.toolLabel}>{chip}</div> : null}
          {views[idx]}
        </div>
      );
    };

    // Attach a tool output to the bottom of its call so the call/output read as
    // one connected card; the assistant message stays a separate peer above.
    const items: ReactNode[] = [];
    for (let idx = 0; idx < views.length; idx++) {
      if (viewKinds[idx] === "tool" && viewKinds[idx + 1] === "tool-result") {
        items.push(
          <div
            key={`chat-message-row-${index}-toolgroup-${idx}`}
            className={styles.attachedGroup}
          >
            {renderPart(idx, { bottom: true })}
            {renderPart(idx + 1, { top: true })}
          </div>
        );
        idx++;
      } else {
        items.push(renderPart(idx));
      }
    }

    return <div className={clsx(styles.grid, className)}>{items}</div>;
  } else {
    return views.map((view, idx) => {
      return (
        <div
          key={`chat-message-row-unlabeled-${index}-part-${idx}`}
          data-message-role={resolvedMessage.message.role}
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
}, chatMessageRowEqual);

// Shallow-compare every prop by reference EXCEPT `resolvedMessage`: compare
// that one through the wrapper to its `message`/`toolMessages` references,
// because `resolveMessages` recreates the wrapper each call even when the
// underlying turn is unchanged (so default memo would never hit). Iterating
// the keys keeps this exhaustive by construction — a future prop is covered by
// the generic `===` branch without editing this function. Callers must pass
// stable option objects (and never mutate a message in place) for it to hit;
// the actively-streaming turn gets a fresh message ref each poll, so it still
// re-renders.
function chatMessageRowEqual(
  prev: ChatMessageRowProps,
  next: ChatMessageRowProps
): boolean {
  const keys = Object.keys(prev) as (keyof ChatMessageRowProps)[];
  if (keys.length !== Object.keys(next).length) return false;
  for (const key of keys) {
    if (key === "resolvedMessage") {
      const a = prev.resolvedMessage;
      const b = next.resolvedMessage;
      if (a.message !== b.message) return false;
      if (a.toolMessages.length !== b.toolMessages.length) return false;
      if (!a.toolMessages.every((t, i) => t === b.toolMessages[i])) {
        return false;
      }
    } else if (prev[key] !== next[key]) {
      return false;
    }
  }
  return true;
}

const resolveToolMessage = (toolMessage?: ChatMessageTool): ContentTool[] => {
  if (!toolMessage || toolMessage.error) {
    return [];
  }

  const content = toolMessage.content;
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
      .map((con): ContentTool | undefined => {
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
          } satisfies ContentTool;
        } else if (con.type !== "tool_use") {
          return {
            content: [con],
            type: "tool",
          } satisfies ContentTool;
        }
      })
      .filter((con) => con !== undefined);
    return result;
  }
};

// Whether a resolved tool output has anything worth rendering in its own
// result box (skip an empty box when the call produced no output).
const hasOutputContent = (output: ContentTool[]): boolean =>
  output.some((tool) =>
    tool.content.some(
      (item) => item.type !== "text" || item.text.trim().length > 0
    )
  );

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
      // Empty redacted blocks (e.g. Google's position-only function_call
      // anchors with no signature) are pure structural metadata and have
      // nothing to display. Real encrypted-reasoning blocks (OpenAI
      // encrypted_content, Anthropic redacted-thinking) carry the encrypted
      // bytes in `reasoning` itself, so `hasReasoning` is true for them and
      // they remain visible.
      return hasReasoning || hasSummary;
    }
    return true;
  });
};

/**
 * Number of sequentially-numbered blocks a row renders. Only the full
 * (un-embedded) layout numbers tool calls individually; every other style
 * keeps the legacy one-number-per-row behavior.
 */
export const countRowBlocks = (
  resolved: ResolvedMessage,
  toolCallStyle: ChatViewToolOptions["callStyle"]
): number => {
  if (toolCallStyle !== "complete") return 1;
  const message = resolved.message;
  const hasToolCalls =
    message.role === "assistant" && !!message.tool_calls?.length;
  const skipChatMessage = hasToolCalls && !hasVisibleContent(message);
  return (
    (skipChatMessage ? 0 : 1) + (hasToolCalls ? message.tool_calls!.length : 0)
  );
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
