import clsx from "clsx";
import { CSSProperties, forwardRef, useCallback } from "react";

import { useProgressiveTask } from "../hooks/useProgressiveTask";
import { useRevealedChildren } from "../hooks/useRevealedChildren";

import { ChunkedText, chunkProps, useChunkLayout } from "./ChunkedText";
import { useHasAllContentPermissions } from "./ContentTrustContext";
import { markdownPipeline } from "./markdownPipelineLoader";
import type { MarkdownSegment } from "./markdownRendering";
import { escapeHtmlCharacters } from "./markdownText";
import { kChunkThreshold } from "./textChunks";
import { yieldToBrowser } from "./yieldToBrowser";

interface SegmentedMarkdownDivProps {
  markdown: string;
  renderer: "full" | "fragment";
  style?: CSSProperties;
  className?: string | string[];
  postProcess?: (html: string) => string;
  onClick?: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}

interface Segmented {
  segments: MarkdownSegment[];
  /** Each segment's source as HTML text, shown until the segment renders. */
  placeholders: string[];
  /** A segment's sanitized HTML, rendered on first request. */
  renderHtml: (index: number) => string;
}

// Rendered markdown is far taller per character than plain text (lists,
// tables, code blocks), so its chunks are smaller: the browser lays out every
// chunk on screen on each resize.
const kSegmentSize = 10_000;

/**
 * Renders a long markdown document as segments of top-level blocks, each a
 * content-visibility chunk. A segment renders to HTML when it first nears
 * the viewport and shows its source text until then: some browsers (Safari)
 * relayout every element on resize, skipped or not, so the DOM holds only
 * the rendered segments.
 */
export const SegmentedMarkdownDiv = forwardRef<
  HTMLDivElement,
  SegmentedMarkdownDivProps
>(({ markdown, renderer, style, className, postProcess, onClick }, ref) => {
  const trusted = useHasAllContentPermissions();
  // Its identity restarts segmenting, so it must change only with its inputs.
  const segmentDocument = useCallback(
    async (publish: (segmented: Segmented) => void, signal: AbortSignal) => {
      const pipeline = await markdownPipeline.load();
      // Let the source placeholder paint before parsing the whole document.
      await yieldToBrowser();
      signal.throwIfAborted();
      const { segments, render } = await pipeline.segmentMarkdown(
        markdown,
        renderer,
        { size: kSegmentSize, hugeBlock: kChunkThreshold }
      );
      const rendered = new Map<number, string>();
      publish({
        segments,
        placeholders: segments.map((segment) =>
          escapeHtmlCharacters(segment.source)
        ),
        renderHtml: (index) => {
          let html = rendered.get(index);
          const segment = segments[index];
          if (html === undefined && segment) {
            const sanitized = pipeline.sanitizeRenderedHtml(render(segment));
            html = postProcess
              ? pipeline.sanitizeRenderedHtml(postProcess(sanitized))
              : sanitized;
            rendered.set(index, html);
          }
          return html ?? "";
        },
      });
    },
    [markdown, renderer, postProcess]
  );
  const segmented = useProgressiveTask(segmentDocument);
  const layoutRef = useChunkLayout<HTMLDivElement>(segmented?.segments);
  const revealed = useRevealedChildren(layoutRef, segmented?.segments);

  if (!trusted) {
    throw new Error("SegmentedMarkdownDiv renders trusted content only");
  }

  return (
    // The container is not itself a control: onClick delegates for the
    // anchors inside the rendered markdown, as in MarkdownDiv.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      ref={ref}
      style={style}
      className={clsx(className, "markdown-content")}
      onClick={onClick}
    >
      {segmented ? (
        <div ref={layoutRef} data-chunk-container>
          {segmented.segments.map((segment, index) => {
            // The edge segments aren't chunks, so they always lay out.
            const edge = index === 0 || index === segmented.segments.length - 1;
            return (
              <Segment
                key={index}
                chars={segment.source.length}
                lines={segment.lines}
                plain={segment.plain}
                chunked={!edge}
                html={
                  !segment.plain && (edge || revealed.has(index))
                    ? segmented.renderHtml(index)
                    : undefined
                }
                placeholder={segmented.placeholders[index] ?? ""}
              />
            );
          })}
        </div>
      ) : (
        <div className="markdown-segment-pending">
          <ChunkedText text={markdown} />
        </div>
      )}
    </div>
  );
});

SegmentedMarkdownDiv.displayName = "SegmentedMarkdownDiv";

interface SegmentProps {
  chars: number;
  lines: number;
  plain: MarkdownSegment["plain"];
  /** False for the first and last segments: a chunk contains its children's
   *  margins, which at the document's edges collapse through it instead. */
  chunked: boolean;
  html: string | undefined;
  placeholder: string;
}

const Segment = ({
  chars,
  lines,
  plain,
  chunked,
  html,
  placeholder,
}: SegmentProps) => {
  if (plain) {
    // Its text is chunked inside, so the segment itself is not a chunk.
    return (
      <div className="markdown-segment">
        {plain.code ? (
          <pre>
            <code>
              <ChunkedText text={plain.text} />
            </code>
          </pre>
        ) : (
          <div className="markdown-segment-text">
            <ChunkedText text={plain.text} />
          </div>
        )}
      </div>
    );
  }
  const chunk = chunked ? chunkProps(chars, lines) : undefined;
  return (
    <div
      className={clsx(
        "markdown-segment",
        html === undefined && "markdown-segment-pending",
        chunk?.className
      )}
      style={chunk?.style}
      dangerouslySetInnerHTML={{ __html: html ?? placeholder }}
    />
  );
};
