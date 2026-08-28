import clsx from "clsx";
import JSON5 from "json5";
import { FC, Fragment, ReactNode, useRef } from "react";

import type {
  Citation,
  ContentAudio,
  ContentData,
  ContentDocument,
  ContentImage,
  ContentReasoning,
  ContentText,
  ContentToolUse,
  ContentVideo,
} from "@tsmono/inspect-common/types";
import { ExpandablePanel } from "@tsmono/react/components";
import type { MarkdownReference } from "@tsmono/react/components";
import { usePrismHighlight } from "@tsmono/react/hooks";
import { isJson, isRecord, isRenderableImageSource } from "@tsmono/util";

import {
  useDisplayMode,
  type DisplayMode,
} from "../content/DisplayModeContext";
import { RenderedText } from "../content/RenderedText";
import { MediaReference } from "../media/MediaReference";
import {
  audioMimeTypeForFormat,
  isRenderableAudioSource,
  isRenderableVideoSource,
  videoMimeTypeForFormat,
} from "../media/mediaSource";

import { ContentDataView } from "./content-data/ContentDataView";
import { ContentDocumentView } from "./documents/ContentDocumentView";
import { JsonMessageContent } from "./JsonMessageContent";
import { MessageCitations } from "./MessageCitations";
import styles from "./MessageContent.module.css";
import { MessagesContext } from "./MessageContents";
import { ServerToolCall } from "./server-tools/ServerToolCall";
import { ToolOutput } from "./tools/ToolOutput";
import { ContentTool } from "./types";

type ContentObject =
  | ContentText
  | ContentReasoning
  | ContentImage
  | ContentAudio
  | ContentVideo
  | ContentDocument
  | ContentTool
  | ContentData
  | ContentToolUse;

type Contents = string | string[] | ContentObject[];

interface MessageContentProps {
  contents: Contents;
  context: MessagesContext;
  references?: MarkdownReference[];
}

export const isMessageContent = (
  content: unknown
): content is ContentObject => {
  return (
    typeof content === "object" &&
    content !== null &&
    "type" in content &&
    typeof content.type === "string"
  );
};

/**
 * Renders message content based on its type.
 * Supports rendering strings, images, and tools using specific renderers.
 */
export const MessageContent: FC<MessageContentProps> = ({
  contents,
  context,
  references,
}) => {
  const displayMode = useDisplayMode();
  const normalized = normalizeContent(contents, displayMode);
  if (Array.isArray(normalized)) {
    return normalized.map((content, index) => {
      if (typeof content === "string") {
        return renderContent(
          `text-content-${index}`,
          {
            type: "text",
            text: content,
            refusal: null,
            internal: null,
            citations: null,
          },
          index === normalized.length - 1,
          context,
          displayMode,
          references
        );
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (content) {
          return renderContent(
            `text-${content.type}-${index}`,
            content,
            index === normalized.length - 1,
            context,
            displayMode,
            references
          );
        }
      }
    });
  } else {
    // This is a simple string
    const contentText: ContentText = {
      type: "text",
      text: normalized,
      refusal: null,
      internal: null,
      citations: null,
    };
    return renderContent(
      "text-message-content",
      contentText,
      true,
      context,
      displayMode,
      references
    );
  }
};

// A switch narrows `content` per case, where a Record lookup couldn't tie a
// key to its value's parameter type. `satisfies never` in the default makes
// the switch exhaustive over ContentObject at compile time; log data can
// still carry types newer than the union, which land in the default at
// runtime.
const renderContent = (
  key: string,
  content: ContentObject,
  isLast: boolean,
  _context: MessagesContext,
  displayMode: DisplayMode,
  references?: MarkdownReference[]
): ReactNode => {
  switch (content.type) {
    case "text": {
      const c = content;
      const cites = c.citations ?? [];

      if (!c.text && !cites.length) {
        return undefined;
      }

      if (displayMode === "rendered" && isJson(c.text)) {
        const parsed: unknown = JSON.parse(c.text);
        if (isRecord(parsed)) {
          return <JsonMessageContent id={`${key}-json`} json={parsed} />;
        }
      }
      return (
        <Fragment key={key}>
          <RenderedText
            markdown={c.text}
            className={clsx(
              isLast ? "no-last-para-padding" : "",
              styles.breakable
            )}
            references={references}
          />
          {c.citations && c.citations.length > 0 ? (
            <MessageCitations citations={c.citations} />
          ) : undefined}
        </Fragment>
      );
    }
    case "reasoning": {
      const r = content;

      // Possible titles
      let title = "Reasoning";
      let text = r.reasoning;
      if (r.redacted) {
        text = r.summary || "Reasoning encrypted by model provider.";
        if (r.summary) {
          title = "Reasoning (Summary)";
        }
      } else if (!text) {
        text = r.summary || "Reasoning text not provided.";
        if (r.summary) {
          title = "Reasoning (Summary)";
        }
      }

      // Detect OpenRouter-style reasoning (JSON array format)
      const renderReasoningCode = isOpenRouterReasoning(text);

      const codeFormatted = renderReasoningCode
        ? JSON.stringify(jsonParse(text), null, 2)
        : text;

      return (
        <div
          key={key}
          data-content-kind="reasoning"
          className={clsx(styles.reasoning, "text-size-small")}
        >
          <div
            className={clsx(
              "text-style-label",
              "text-style-secondary",
              isLast ? "no-last-para-padding" : ""
            )}
          >
            {title}
          </div>
          <ExpandablePanel id={`${key}-reasoning`} collapse={true}>
            {!renderReasoningCode && <RenderedText markdown={codeFormatted} />}
            {renderReasoningCode && (
              <CodePanel language="json" code={codeFormatted} />
            )}
          </ExpandablePanel>
        </div>
      );
    }
    case "image": {
      const c = content;
      if (isRenderableImageSource(c.image)) {
        return (
          <img
            src={c.image}
            alt="Message attachment"
            className={styles.contentImage}
            key={key}
          />
        );
      } else {
        return <MediaReference source={c.image} key={key} />;
      }
    }
    case "audio": {
      const c = content;
      if (!isRenderableAudioSource(c.audio, c.format)) {
        return <MediaReference source={c.audio} key={key} />;
      }
      return (
        // Log content carries no caption track and none can be synthesised
        // here; the audio is model input being replayed, not authored media.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio controls key={key}>
          <source src={c.audio} type={audioMimeTypeForFormat(c.format)} />
        </audio>
      );
    }
    case "video": {
      const c = content;
      if (!isRenderableVideoSource(c.video, c.format)) {
        return <MediaReference source={c.video} key={key} />;
      }
      return (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- see audio above
        <video width="500" height="375" controls key={key}>
          <source src={c.video} type={videoMimeTypeForFormat(c.format)} />
        </video>
      );
    }
    case "tool": {
      return <ToolOutput output={content.content} key={key} />;
    }
    // server-side tool use. Assistant turns render these as flush rows of the
    // turn container (see ChatMessage); this fallback covers any other
    // context, so the block carries its own frame.
    case "tool_use": {
      return <ServerToolCall id={key} content={content} flush={false} />;
    }
    case "data": {
      return <ContentDataView id={key} contentData={content} />;
    }
    case "document": {
      return <ContentDocumentView id={key} document={content} />;
    }
    default: {
      const unknownContent: { type: string } = content satisfies never;
      console.error(
        `Unknown message content type '${unknownContent.type}'`
      );
      return undefined;
    }
  }
};

/**
 * Renders message content based on its type.
 * Supports rendering strings, images, and tools using specific renderers.
 */
// This collapses sequential runs of text content into a single text content,
// adding citations as superscript counters at the end of the text for each block
// containing citations. The citations are then attached to the content where
// they can be rendered separately (with coordinating numbers).
const normalizeContent = (
  contents: Contents,
  displayMode: DisplayMode
): Contents => {
  // Raw mode presents the logged content blocks without citation injection or
  // other rendered-mode normalization.
  if (displayMode === "raw") {
    return contents;
  }

  // its a string
  if (typeof contents === "string") {
    return contents;
  }

  // its an array of strings
  if (contents.length > 0 && typeof contents[0] === "string") {
    return contents;
  }

  const result: ContentObject[] = [];
  const collection: ContentText[] = [];

  const collect = () => {
    if (collection.length > 0) {
      // Flatten the citations from the collection
      const filteredCitations = collection.flatMap((c) => c.citations || []);
      // Render citations as superscript counters
      let citeCount = 0;
      const textWithCites = collection
        .map((c) => {
          // separate the cites into those with a position and those without
          // sort by end_index (to allow for numbering to not affect indexes)
          // Type guard function to check if cited_text is a range
          const positionalCites = (c.citations ?? [])
            .filter(isCitationWithRange)
            .sort((a, b) => b.cited_text[1] - a.cited_text[1]);

          const endCites = c.citations?.filter(
            (citation) => !isCitationWithRange(citation)
          );

          // Process cites with positions
          let textWithCites = c.text;
          for (let i = 0; i < positionalCites.length; i++) {
            const end_index = positionalCites[i]?.cited_text[1];

            textWithCites =
              textWithCites.slice(0, end_index) +
              `<sup>${positionalCites.length - i}</sup>` +
              textWithCites.slice(end_index);
          }
          citeCount = citeCount + positionalCites.length;

          // Process cites without positions (they just attach to the end of the content)
          const citeText = endCites?.map(() => `${++citeCount}`);
          let inlineCites = "";
          if (citeText && citeText.length > 0) {
            inlineCites = `<sup>${citeText.join(",")}</sup>`;
          }
          return (textWithCites || "") + inlineCites;
        })
        .join("");

      // Flatten the text from the collection into a single text content
      result.push({
        type: "text",
        text: textWithCites,
        refusal: null,
        internal: null,
        citations: filteredCitations,
      });
      collection.length = 0;
    }
  };

  for (const content of contents) {
    if (typeof content === "string") {
      // this shouldn't happen, but if it does
      // just convert it to a text content
      result.push({
        type: "text",
        text: content,
        refusal: null,
        internal: null,
        citations: null,
      });
      continue;
    }

    if (content.type === "text") {
      // Collect text until we hit a  non-text content
      collection.push(content);
      continue;
    } else {
      // collect any text content before this non-text content
      collect();
      result.push(content);
    }
  }

  // collect any remaining text content
  collect();

  return result;
};

// This is a helper that makes Omit<> work with a union type by distributing
// the omit over the union members.
export type DistributiveOmit<
  TObj,
  TKey extends PropertyKey,
> = TObj extends unknown ? Omit<TObj, TKey> : never;

/** Type guard that allows narrowing down to Citations whose `cited_text` is a range */
const isCitationWithRange = (
  citation: Citation
): citation is DistributiveOmit<Citation, "cited_text"> & {
  cited_text: [number, number];
} => Array.isArray(citation.cited_text);

const isOpenRouterReasoning = (text: string): boolean => {
  return text.startsWith("[{'format'");
};

const jsonParse = (text: string): unknown => {
  try {
    const result: unknown = JSON.parse(text);
    return result;
  } catch {
    const result: unknown = JSON5.parse(text);
    return result;
  }
};

/**
 * Inline code panel for formatted code display (e.g. OpenRouter reasoning).
 */
const CodePanel: FC<{ code: string; language?: string }> = ({
  code,
  language = "json",
}) => {
  const codeContainerRef = useRef<HTMLDivElement>(null);
  usePrismHighlight(codeContainerRef, code.length);
  return (
    <div ref={codeContainerRef} className={clsx(styles.codePanel)}>
      <pre className={clsx(styles.codePanelPre)}>
        <code className={clsx(`language-${language}`)}>{code}</code>
      </pre>
    </div>
  );
};
