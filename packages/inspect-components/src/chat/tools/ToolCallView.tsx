import clsx from "clsx";
import { FC, useMemo } from "react";

import type {
  ContentAudio,
  ContentData,
  ContentDocument,
  ContentImage,
  ContentReasoning,
  ContentText,
  ContentVideo,
  ToolCallContent,
} from "@tsmono/inspect-common/types";
import { ExpandablePanel, MarkdownDiv } from "@tsmono/react/components";

import { MessageContent } from "../MessageContent";
import { defaultContext, MessagesContext } from "../MessageContents";
import { ContentTool } from "../types";

import { getDefaultCustomToolView } from "./customToolRendering";
import { codexToolMarkdown } from "./tool";
import styles from "./ToolCallView.module.css";
import { ToolInput } from "./ToolInput";
import { ToolTitle } from "./ToolTitle";

export interface ToolCallViewProps {
  id: string;
  tool: string;
  functionCall: string;
  input?: unknown;
  description?: string;
  contentType?: string;
  view?: ToolCallContent;
  output:
    | string
    | number
    | boolean
    | ContentText
    | ContentAudio
    | ContentImage
    | ContentVideo
    | ContentTool
    | ContentReasoning
    | ContentData
    | ContentDocument
    | (
        | ContentText
        | ContentAudio
        | ContentImage
        | ContentVideo
        | ContentTool
        | ContentReasoning
        | ContentData
        | ContentDocument
      )[];
  mode?: "compact";
  collapsible?: boolean;
  /** Render the whole view, just the call (title + input), or just the output. */
  section?: "all" | "call" | "output";
  getCustomToolView?: (props: ToolCallViewProps) => React.ReactNode | undefined;
}

/**
 * Renders the ToolCallView component.
 */
export const ToolCallView: FC<ToolCallViewProps> = ({
  id,
  tool,
  functionCall,
  input,
  description,
  contentType,
  view,
  output,
  mode,
  collapsible = true,
  section = "all",
  getCustomToolView,
}) => {
  // don't collapse if output includes an image
  function isContentImage(
    value:
      | string
      | number
      | boolean
      | ContentText
      | ContentAudio
      | ContentImage
      | ContentVideo
      | ContentTool
      | ContentReasoning
      | ContentData
      | ContentDocument
  ) {
    if (value && typeof value === "object") {
      if (value.type === "image") {
        return true;
      } else if (value.type === "tool") {
        if (
          Array.isArray(value.content) &&
          value.content.some(isContentImage)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  const collapse = Array.isArray(output)
    ? output.every((item) => !isContentImage(item))
    : !isContentImage(output);
  // Render-time reshape of tool output (e.g. surface Codex sub-agent answers /
  // tool_search catalog). Does not mutate stored data — the raw output remains
  // visible in the JSON tab.
  const normalizedContent = useMemo(() => {
    const markdown = codexToolMarkdown(tool, output);
    return normalizeContent(markdown !== undefined ? markdown : output);
  }, [tool, output]);

  const hasContent = normalizedContent.find((c) => {
    if (c.type === "tool") {
      for (const t of c.content) {
        if (t.type === "text") {
          if (t.text) {
            return true;
          }
        } else {
          return true;
        }
      }
      return false;
    } else {
      return true;
    }
  });

  // See if there is a custom view for this tool
  const props: ToolCallViewProps = {
    id,
    tool,
    functionCall,
    input,
    description,
    contentType,
    output,
    mode,
  };
  const customView =
    getCustomToolView?.(props) ?? getDefaultCustomToolView(props);
  if (customView) {
    // A custom view renders the call and its result together, so it belongs to
    // the call section; the output section then contributes nothing.
    return section === "output" ? null : customView;
  }

  const contents = mode !== "compact" ? input : input || functionCall;
  const context = defaultContext();

  const callSection = (
    <div>
      {mode !== "compact" && (!view || view.title) ? (
        <ToolTitle
          title={view?.title || functionCall}
          description={description}
        />
      ) : (
        ""
      )}
      <ExpandablePanel
        id={`${id}-tool-input`}
        collapse={true}
        border={false}
        lines={20}
        className={clsx("text-size-small")}
      >
        <ToolInput
          contentType={contentType}
          contents={contents}
          toolCallView={view}
        />
      </ExpandablePanel>
    </div>
  );

  const outputSection =
    contentType === "markdown" && hasContent ? (
      <ExpandablePanel
        id={`${id}-tool-content`}
        collapse={collapse}
        border={false}
        lines={15}
        className={clsx("text-size-small")}
      >
        <MarkdownToolOutput contents={normalizedContent} context={context} />
      </ExpandablePanel>
    ) : hasContent && collapsible ? (
      <ExpandablePanel
        id={`${id}-tool-content`}
        collapse={collapse}
        border={false}
        lines={15}
        className={clsx("text-size-small")}
      >
        <MessageContent contents={normalizedContent} context={context} />
      </ExpandablePanel>
    ) : hasContent ? (
      <MessageContent contents={normalizedContent} context={context} />
    ) : null;

  return (
    <div className={clsx(styles.toolCallView)}>
      {section !== "output" ? callSection : null}
      {section !== "call" ? outputSection : null}
    </div>
  );
};

/**
 * Renders the ToolCallView component.
 */
type NormalizedContentItem =
  | ContentText
  | ContentImage
  | ContentAudio
  | ContentVideo
  | ContentTool
  | ContentReasoning
  | ContentData
  | ContentDocument;

/**
 * Renders tool output with text as markdown, passing non-text content
 * (e.g. images) through MessageContent for normal rendering.
 */
const MarkdownToolOutput: FC<{
  contents: NormalizedContentItem[];
  context: MessagesContext;
}> = ({ contents, context }) => {
  // Flatten tool wrapper to get inner content items
  const items = contents.flatMap((c) => (c.type === "tool" ? c.content : [c]));

  return (
    <>
      {items.map((item, i) => {
        if (item.type === "text" && item.text) {
          return <MarkdownDiv key={`md-${i}`} markdown={item.text} />;
        }
        return (
          <MessageContent
            key={`content-${i}`}
            contents={[item] as NormalizedContentItem[]}
            context={context}
          />
        );
      })}
    </>
  );
};

const normalizeContent = (
  output:
    | string
    | number
    | boolean
    | ContentText
    | ContentImage
    | ContentAudio
    | ContentVideo
    | ContentTool
    | ContentReasoning
    | ContentData
    | ContentDocument
    | (
        | ContentText
        | ContentImage
        | ContentAudio
        | ContentVideo
        | ContentTool
        | ContentReasoning
        | ContentData
        | ContentDocument
      )[]
): (
  | ContentText
  | ContentImage
  | ContentAudio
  | ContentVideo
  | ContentTool
  | ContentReasoning
  | ContentData
  | ContentDocument
)[] => {
  if (Array.isArray(output)) {
    return output;
  } else {
    return [
      {
        type: "tool",
        content: [
          {
            type: "text",
            text:
              typeof output === "object"
                ? JSON.stringify(output)
                : String(output),
            refusal: null,
            internal: null,
            citations: null,
          },
        ],
      },
    ];
  }
};
