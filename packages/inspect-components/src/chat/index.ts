// Types
export type {
  ChatViewToolCallStyle,
  ChatViewDisplayOptions,
  ChatViewLabelOptions,
  ChatViewLinkingOptions,
  ChatViewToolOptions,
  ContentTool,
} from "./types";

export type { Message, ResolvedMessage } from "./messages";
export { resolveMessages } from "./messages";

export type {
  MessageRow,
  MessageRowOptions,
  ScannedRowFact,
} from "./rowsModel";
export {
  buildMessageRows,
  buildMessageRowsWindow,
  buildSystemMessageRow,
  countRowBlocks,
  MessageRowScanner,
  messageRowOptions,
  rowContainsMessage,
} from "./rowsModel";

export type { MessagesToStrOptions } from "./messagesToStr";
export { messagesToStr } from "./messagesToStr";

export { messageSearchText } from "./messageSearchText";

// Tool utilities
export type { ToolCallResult } from "./tools/tool";
export {
  kToolTodoContentType,
  resolveToolInput,
  substituteToolCallContent,
} from "./tools/tool";

// Components
export type { ToolCallViewProps } from "./tools/ToolCallView";
export { ToolCallView } from "./tools/ToolCallView";
export type { ClientToolCallProps } from "./tools/ClientToolCall";
export { ClientToolCall } from "./tools/ClientToolCall";
export { ToolBlock, ToolBlockInput, ToolBlockOutput } from "./tools/ToolBlock";
export { ToolCallErrorView } from "./tools/ToolCallErrorView";
export { ToolOutput } from "./tools/ToolOutput";
export { MessageContent, isMessageContent } from "./MessageContent";
export { MessageContents } from "./MessageContents";
export { ChatMessage } from "./ChatMessage";
export { ChatMessageRow } from "./ChatMessageRow";
export type { ChatViewProps } from "./ChatView";
export { ChatView } from "./ChatView";
export type {
  ChatViewRowsVirtualListProps,
  ChatViewVirtualListProps,
} from "./ChatViewVirtualList";
export {
  ChatViewRowsVirtualList,
  ChatViewVirtualList,
} from "./ChatViewVirtualList";
