import clsx from "clsx";
import { CSSProperties, forwardRef, useCallback } from "react";

import { useProgressiveTask } from "../hooks/useProgressiveTask";

import { ChunkedText, chunkProps, useChunkLayout } from "./ChunkedText";
import { useHasAllContentPermissions } from "./ContentTrustContext";
import { markdownPipeline } from "./markdownPipelineLoader";
import type { MarkdownSegment } from "./markdownRendering";
import { escapeHtmlCharacters } from "./markdownText";
import { kChunkThreshold } from "./textChunks";

interface SegmentedMarkdownDivProps {
  markdown: string;
  renderer: "full" | "fragment";
  style?: CSSProperties;
  className?: string | string[];
  postProcess?: (html: string) => string;
  onClick?: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}

interface Rendered {
  segments: MarkdownSegment[];
  /** Each segment's source as HTML text, shown until the segment renders. */
  placeholders: string[];
  /** Sanitized HTML of the segments rendered so far, in order. */
  html: string[];
}

// Rendered markdown is far taller per character than plain text (lists,
// tables, code blocks), so its chunks are smaller: the browser lays out every
// chunk on screen on each resize.
const kSegmentSize = 10_000;

// Work done before yielding to the browser, so rendering a huge document
// never blocks input or painting for long.
const kSliceMs = 12;

// How often finished segments are committed.
const kPublishMs = 150;

// A message-channel task, unlike a nested setTimeout(0), isn't clamped to 4ms.
const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });

/**
 * Renders a long markdown document as segments of top-level blocks, each a
 * content-visibility chunk, so the browser lays out only the segments near
 * the viewport. Segments render to HTML a slice at a time; until a segment
 * has, it shows its source text, which find-in-page can already reach.
 */
export const SegmentedMarkdownDiv = forwardRef<
  HTMLDivElement,
  SegmentedMarkdownDivProps
>(({ markdown, renderer, style, className, postProcess, onClick }, ref) => {
  const trusted = useHasAllContentPermissions();
  // Its identity restarts rendering, so it must change only with its inputs.
  const renderSegments = useCallback(
    async (publish: (rendered: Rendered) => void, signal: AbortSignal) => {
      const pipeline = await markdownPipeline.load();
      // Let the source placeholder paint before parsing the whole document.
      await yieldToBrowser();
      signal.throwIfAborted();
      const { segments, render } = await pipeline.segmentMarkdown(
        markdown,
        renderer,
        { size: kSegmentSize, hugeBlock: kChunkThreshold }
      );
      const placeholders = segments.map((segment) =>
        escapeHtmlCharacters(segment.source)
      );
      const html: string[] = [];
      publish({ segments, placeholders, html: [] });
      let sliceStart = performance.now();
      let lastPublish = sliceStart;
      for (const segment of segments) {
        signal.throwIfAborted();
        if (segment.plain) {
          html.push("");
          continue;
        }
        const sanitized = pipeline.sanitizeRenderedHtml(render(segment));
        html.push(
          postProcess
            ? pipeline.sanitizeRenderedHtml(postProcess(sanitized))
            : sanitized
        );
        if (performance.now() - sliceStart > kSliceMs) {
          if (performance.now() - lastPublish > kPublishMs) {
            publish({ segments, placeholders, html: [...html] });
            lastPublish = performance.now();
          }
          await yieldToBrowser();
          sliceStart = performance.now();
        }
      }
      publish({ segments, placeholders, html });
    },
    [markdown, renderer, postProcess]
  );
  const rendered = useProgressiveTask(renderSegments);
  const layoutRef = useChunkLayout<HTMLDivElement>(rendered?.segments);

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
      {rendered ? (
        <div ref={layoutRef} data-chunk-container>
          {rendered.segments.map((segment, index) => (
            <Segment
              key={index}
              chars={segment.source.length}
              lines={segment.lines}
              plain={segment.plain}
              chunked={index > 0 && index < rendered.segments.length - 1}
              html={rendered.html[index]}
              placeholder={rendered.placeholders[index] ?? ""}
            />
          ))}
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
