import type {
  Content,
  ContentCitation,
  DocumentCitation,
  UrlCitation,
} from "@tsmono/inspect-common/types";

export type ChatViewToolCallStyle = "compact" | "complete" | "omit";

export interface ChatViewDisplayOptions {
  /** Indent message content. Default: false. */
  indented?: boolean;
  /** Roles whose header row is hidden. */
  unlabeledRoles?: string[];
  /** Format timestamps shown on messages. When absent, timestamps are hidden. */
  formatDateTime?: (date: Date) => string;
}

export interface ChatViewLabelOptions {
  /** Custom labels keyed by message id (e.g. citation refs). */
  values?: Record<string, string>;
  /** Show auto-numbered labels. Default: true. */
  show?: boolean;
  /** Highlight rows that have a label. Default: false. */
  highlight?: boolean;
}

export interface ChatViewLinkingOptions {
  /** Show link UI on messages. Default: false. */
  enabled?: boolean;
  /** Build a shareable URL for a message id. */
  getUrl?: (messageId: string) => string | undefined;
  /** Icon class for the link button. Default: "bi bi-link-45deg". */
  icon?: string;
}

export interface ChatViewToolOptions {
  /** How tool calls render: full detail, inline summary, or hidden. Default: "complete". */
  callStyle?: ChatViewToolCallStyle;
  /** Collapse tool responses into the preceding assistant message. Default: true. */
  resolveIntoPreviousMessage?: boolean;
  /** Override default tool call rendering for specific tools. */
  getCustomView?: (
    props: import("./tools/ToolCallView").ToolCallViewProps
  ) => React.ReactNode | undefined;
}

export type Citations = Array<
  ContentCitation | DocumentCitation | UrlCitation
> | null;
export type Citation = NonNullable<Citations>[number];

export interface ContentTool {
  type: "tool";
  content: Exclude<Content, { type: "tool_use" }>[];
}
