import clsx from "clsx";
import { CSSProperties, forwardRef, useCallback, useRef } from "react";

import { scrollingAncestor } from "../hooks/scrollingAncestor";
import type { ScrollAnchor } from "../hooks/useChildScrollAnchoring";
import { useProgressiveTask } from "../hooks/useProgressiveTask";
import { useRevealedChildren } from "../hooks/useRevealedChildren";

import { ChunkedText, chunkProps, useChunkLayout } from "./ChunkedText";
import { useHasAllContentPermissions } from "./ContentTrustContext";
import { markdownPipeline } from "./markdownPipelineLoader";
import type { MarkdownSegment } from "./markdownRendering";
import { escapeHtmlCharacters, kSourceLineAttribute } from "./markdownText";
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

/** A segmented document, and its segments' HTML as they're rendered. */
interface Segmentation {
  segments: MarkdownSegment[];
  /** Each segment's source as HTML text, shown until the segment renders. */
  placeholders: string[];
  render: (segment: MarkdownSegment) => string;
  sanitize: (html: string) => string;
  /** Sanitized HTML by segment index. */
  html: Map<number, string>;
  /** Post-processed HTML by segment index, per post-processor. */
  postProcessed: WeakMap<(html: string) => string, Map<number, string>>;
}

// Rendered markdown is far taller per character than plain text (lists,
// tables, code blocks), so its chunks are smaller: the browser lays out every
// chunk on screen on each resize.
const kSegmentSize = 10_000;

/**
 * Renders a long markdown document as segments of top-level blocks, each a
 * content-visibility chunk. A segment renders to HTML when it first nears
 * the viewport and shows its source text until then: some browsers (Safari)
 * relayout every element on resize, skipped or not, so only the segments
 * read so far hold rendered HTML.
 */
export const SegmentedMarkdownDiv = forwardRef<
  HTMLDivElement,
  SegmentedMarkdownDivProps
>(({ markdown, renderer, style, className, postProcess, onClick }, ref) => {
  const trusted = useHasAllContentPermissions();
  // Its identity restarts segmenting, so it must change only with its inputs.
  const segmentDocument = useCallback(
    async (
      publish: (segmentation: Segmentation) => void,
      signal: AbortSignal
    ) => {
      const cached = cachedSegmentation(renderer, markdown);
      if (cached) {
        publish(cached);
        return;
      }
      const pipeline = await markdownPipeline.load();
      // Let the source placeholder paint before parsing the whole document.
      await yieldToBrowser();
      signal.throwIfAborted();
      const { segments, render } = await pipeline.segmentMarkdown(
        markdown,
        renderer,
        { size: kSegmentSize, hugeBlock: kChunkThreshold }
      );
      publish(
        cacheSegmentation(renderer, markdown, {
          segments,
          placeholders: segments.map((segment) =>
            escapeHtmlCharacters(segment.source)
          ),
          render,
          sanitize: pipeline.sanitizeRenderedHtml,
          html: new Map(),
          postProcessed: new WeakMap(),
        })
      );
    },
    [markdown, renderer]
  );
  const segmentation =
    useProgressiveTask(segmentDocument) ??
    cachedSegmentation(renderer, markdown);

  if (!trusted) {
    throw new Error("SegmentedMarkdownDiv renders trusted content only");
  }

  return (
    // Not itself a control: onClick delegates for the anchors inside the
    // rendered markdown, which handle Enter themselves.
    <div
      ref={ref}
      role="presentation"
      style={style}
      className={clsx(className, "markdown-content")}
      onClick={onClick}
    >
      {segmentation ? (
        <SegmentList segmentation={segmentation} postProcess={postProcess} />
      ) : (
        <div className="markdown-segment-pending">
          <ChunkedText text={markdown} />
        </div>
      )}
    </div>
  );
});

SegmentedMarkdownDiv.displayName = "SegmentedMarkdownDiv";

// Its own component so the chunk container exists when its layout hooks
// first run.
const SegmentList = ({
  segmentation,
  postProcess,
}: {
  segmentation: Segmentation;
  postProcess: ((html: string) => string) | undefined;
}) => {
  const { segments, placeholders } = segmentation;
  const anchorRef = useRef<ScrollAnchor | null>(null);
  const layoutRef = useChunkLayout<HTMLDivElement>(segments, anchorRef);
  const revealed = useRevealedChildren(layoutRef, segments, (indexes) => {
    const container = layoutRef.current;
    const anchor = container && centerAnchor(container, indexes);
    if (anchor) {
      anchorRef.current = anchor;
    }
  });
  const last = segments.length - 1;
  return (
    <div ref={layoutRef} data-chunk-container>
      {segments.map((segment, index) => {
        // The edge segments aren't chunks, so they always lay out.
        const edge = index === 0 || index === last;
        return (
          <Segment
            key={index}
            chars={segment.source.length}
            lines={segment.lines}
            plain={segment.plain}
            chunked={!edge}
            html={
              !segment.plain && (edge || revealed.has(index))
                ? segmentHtml(segmentation, index, postProcess)
                : undefined
            }
            placeholder={placeholders[index] ?? ""}
          />
        );
      })}
    </div>
  );
};

// Swapping a segment's source for its HTML moves the text inside it. Find in
// page scrolls a match in the source to the viewport's center, so the source
// line there is kept in place once the segment renders.
const centerAnchor = (
  container: HTMLElement,
  indexes: number[]
): ScrollAnchor | undefined => {
  const scroller = scrollingAncestor(container);
  if (!scroller) {
    return undefined;
  }
  const view = scroller.getBoundingClientRect();
  const center = view.top + view.height / 2;
  for (const index of indexes) {
    const segment = container.children[index];
    const text = segment?.firstChild;
    if (
      !segment?.classList.contains("markdown-segment-pending") ||
      !(text instanceof Text)
    ) {
      continue;
    }
    const box = segment.getBoundingClientRect();
    if (box.top > center || box.bottom <= center) {
      continue;
    }
    const offset = offsetAtY(text, center);
    const line = sourceLinePosition(text.data, offset);
    const lineCount = sourceLinePosition(text.data, text.length) + 1;
    return {
      target: segment,
      top: charTop(text, offset),
      scrollTop: scroller.scrollTop,
      locate: () => renderedLineTop(segment, line, lineCount),
    };
  }
  return undefined;
};

const charTop = (text: Text, offset: number): number => {
  const range = document.createRange();
  range.setStart(text, offset);
  range.setEnd(text, Math.min(offset + 1, text.length));
  const box = range.getBoundingClientRect();
  // A line break can have no box of its own; the character before it shares
  // its row.
  return box.height > 0 || offset === 0 ? box.top : charTop(text, offset - 1);
};

// The last character whose row starts at or above `y`.
const offsetAtY = (text: Text, y: number): number => {
  let low = 0;
  let high = Math.max(0, text.length - 1);
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (charTop(text, mid) <= y) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
};

// The line `offset` falls on, plus how far along that line it is.
const sourceLinePosition = (source: string, offset: number): number => {
  let line = 0;
  let lineStart = 0;
  for (let i = source.indexOf("\n"); i !== -1 && i < offset;) {
    line++;
    lineStart = i + 1;
    i = source.indexOf("\n", i + 1);
  }
  const lineEnd = source.indexOf("\n", lineStart);
  const length = (lineEnd === -1 ? source.length : lineEnd) - lineStart;
  return line + (length > 0 ? Math.min(1, (offset - lineStart) / length) : 0);
};

// Where a source line sits in the segment's rendered HTML: within the block
// it falls in, as far down as it is through that block's lines.
const renderedLineTop = (
  segment: Element,
  line: number,
  lineCount: number
): number | undefined => {
  if (segment.classList.contains("markdown-segment-pending")) {
    return undefined;
  }
  const blocks = [...segment.querySelectorAll(`[${kSourceLineAttribute}]`)];
  const starts = blocks.map((block) =>
    Number(block.getAttribute(kSourceLineAttribute))
  );
  const index = starts.findLastIndex((start) => start <= line);
  const block = blocks[index];
  const start = starts[index];
  if (!block || start === undefined) {
    return segment.getBoundingClientRect().top;
  }
  const end = starts[index + 1] ?? lineCount;
  const box = block.getBoundingClientRect();
  return box.top + ((line - start) / Math.max(1, end - start)) * box.height;
};

const segmentHtml = (
  segmentation: Segmentation,
  index: number,
  postProcess: ((html: string) => string) | undefined
): string => {
  const segment = segmentation.segments[index];
  if (!segment) {
    return "";
  }
  let html = segmentation.html.get(index);
  if (html === undefined) {
    html = segmentation.sanitize(segmentation.render(segment));
    segmentation.html.set(index, html);
  }
  if (!postProcess) {
    return html;
  }
  let processed = segmentation.postProcessed.get(postProcess);
  if (!processed) {
    processed = new Map();
    segmentation.postProcessed.set(postProcess, processed);
  }
  let result = processed.get(index);
  if (result === undefined) {
    result = segmentation.sanitize(postProcess(html));
    processed.set(index, result);
  }
  return result;
};

// The last few documents segmented. VirtualList unmounts a message's row
// once it scrolls out of range, and segmenting a huge document again would
// cost about half a second each time it comes back.
const kCachedDocuments = 3;
const segmentations = new Map<string, Map<string, Segmentation>>();
const cacheOrder: [renderer: string, markdown: string][] = [];

const cachedSegmentation = (renderer: string, markdown: string) =>
  segmentations.get(renderer)?.get(markdown);

const cacheSegmentation = (
  renderer: string,
  markdown: string,
  segmentation: Segmentation
): Segmentation => {
  let byMarkdown = segmentations.get(renderer);
  if (!byMarkdown) {
    byMarkdown = new Map();
    segmentations.set(renderer, byMarkdown);
  }
  byMarkdown.set(markdown, segmentation);
  const existing = cacheOrder.findIndex(
    ([r, m]) => r === renderer && m === markdown
  );
  if (existing !== -1) {
    cacheOrder.splice(existing, 1);
  }
  cacheOrder.push([renderer, markdown]);
  while (cacheOrder.length > kCachedDocuments) {
    const evicted = cacheOrder.shift();
    if (evicted) {
      segmentations.get(evicted[0])?.delete(evicted[1]);
    }
  }
  return segmentation;
};

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
