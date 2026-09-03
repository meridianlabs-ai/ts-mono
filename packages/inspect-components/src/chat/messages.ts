import type {
  ChatMessage,
  ChatMessageAssistant,
  ChatMessageSystem,
  ChatMessageTool,
  ChatMessageUser,
  ContentAudio,
  ContentData,
  ContentDocument,
  ContentImage,
  ContentReasoning,
  ContentText,
  ContentToolUse,
  ContentVideo,
} from "@tsmono/inspect-common/types";

/**
 * Extended message type that includes an optional timestamp
 * (used by inspect for displaying message timestamps).
 */
export type Message = (
  ChatMessageAssistant | ChatMessageSystem | ChatMessageUser | ChatMessageTool
) & {
  timestamp?: string | null;
};

export interface ResolvedMessage {
  message: Message;
  toolMessages: ChatMessageTool[];
}

/** Whether an assistant message carries server-side tool calls (provider
 * executed `tool_use` content blocks) — these render as flush rows of the
 * assistant turn container rather than as message body. */
export const hasServerToolUse = (message: Message): boolean => {
  return (
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some((c) => c.type === "tool_use")
  );
};

/**
 * The streaming tool-fold: feed messages in conversation order and receive
 * completed `ResolvedMessage` rows — a row is one non-tool message plus the
 * tool messages that follow it, and it completes when the next non-tool
 * message arrives (or `end()` closes the fold). `index` is the message's
 * whole-conversation position: ids minted for id-less messages are
 * `msg-${index}`, so a fold over any window of the conversation yields the
 * same ids as a fold over all of it.
 */
export class MessageFold {
  private open: ResolvedMessage | undefined;

  constructor(private readonly onRow: (row: ResolvedMessage) => void) {}

  next(message: ChatMessage, index: number): void {
    // Create a stable id for the item without mutating the original
    const resolved =
      message.id === undefined ? { ...message, id: `msg-${index}` } : message;
    if (resolved.role === "tool") {
      // Add this tool message onto the previous message; a tool message
      // with no preceding non-tool message is dropped
      this.open?.toolMessages.push(resolved);
      return;
    }
    this.flush();
    this.open = { message: resolved, toolMessages: [] };
  }

  end(): void {
    this.flush();
    this.open = undefined;
  }

  private flush(): void {
    if (this.open) {
      this.onRow(this.open);
    }
  }
}

/**
 * Collapse system messages into the single synthetic system message the
 * chat renders as its first row (content concatenated in conversation
 * order). Undefined when there is no system content to show.
 */
export const mergedSystemMessage = (
  systemMessages: readonly ChatMessageSystem[]
): ChatMessageSystem | undefined => {
  const systemContent = systemMessages.flatMap((systemMessage) => {
    const contents = Array.isArray(systemMessage.content)
      ? systemMessage.content
      : [systemMessage.content];
    return contents.map(normalizeContent);
  });
  if (systemContent.length === 0) {
    return undefined;
  }
  return {
    id: "sys-message-6815A84B062A",
    role: "system",
    content: systemContent,
    source: "input",
    metadata: null,
  };
};

export const resolveMessages = (messages: ChatMessage[]): ResolvedMessage[] => {
  // Filter tool messages into a sidelist that the chat stream
  // can use to lookup the tool responses
  const resolvedMessages: ResolvedMessage[] = [];
  const fold = new MessageFold((row) => resolvedMessages.push(row));
  messages.forEach((message, index) => {
    fold.next(message, index);
  });
  fold.end();

  // Capture system messages (there could be multiple) and collapse them
  // into the synthetic first row
  const systemMessages: ChatMessageSystem[] = [];
  const collapsedMessages = resolvedMessages.filter((resolved) => {
    if (resolved.message.role === "system") {
      systemMessages.push(resolved.message);
      return false;
    }
    return true;
  });
  const systemMessage = mergedSystemMessage(systemMessages);
  if (systemMessage) {
    collapsedMessages.unshift({ message: systemMessage, toolMessages: [] });
  }
  return collapsedMessages;
};

/**
 * Normalize strings into ContentText objects.
 */
const normalizeContent = (
  content:
    | ContentText
    | ContentImage
    | ContentAudio
    | ContentVideo
    | ContentDocument
    | ContentReasoning
    | ContentData
    | ContentToolUse
    | string
):
  | ContentText
  | ContentImage
  | ContentAudio
  | ContentVideo
  | ContentDocument
  | ContentReasoning
  | ContentData
  | ContentToolUse => {
  if (typeof content === "string") {
    return {
      type: "text",
      text: content,
      refusal: null,
      internal: null,
      citations: null,
    };
  } else {
    return content;
  }
};
