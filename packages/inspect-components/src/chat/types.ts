/* eslint-disable */
import type {
  ContentCitation,
  ContentImage,
  ContentText,
  DocumentCitation,
  UrlCitation,
} from "@tsmono/inspect-common/types";

export type ChatViewToolCallStyle = "compact" | "complete" | "omit";

export type Citations = Array<
  ContentCitation | DocumentCitation | UrlCitation
> | null;
export type Citation = NonNullable<Citations>[number];

export interface ContentTool {
  type: "tool";
  content: (ContentImage | ContentText)[];
}
