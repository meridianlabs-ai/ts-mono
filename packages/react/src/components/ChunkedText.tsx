import { ClipboardEvent, FC } from "react";

import { useChildScrollAnchoring } from "../hooks/useChildScrollAnchoring";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { useResizeObserver } from "../hooks/useResizeObserver";

import { kChunkThreshold, splitTextChunks } from "./textChunks";
import styles from "./ChunkedText.module.css";
import { cssVars } from "./cssVars";

interface ChunkedTextProps {
  text: string;
}

/**
 * Renders text for a `white-space: pre`/`pre-wrap` container. Text longer
 * than `kChunkThreshold` is split at line ends into blocks the browser skips
 * laying out and painting while they are off screen, so resizing or scrolling
 * a multi-megabyte text costs about as much as the part on screen. The text
 * stays in the DOM, so find-in-page and selection still reach all of it.
 */
export const ChunkedText: FC<ChunkedTextProps> = ({ text }) =>
  text.length <= kChunkThreshold ? text : <TextChunks text={text} />;

/**
 * Layout shared by containers of content-visibility chunks: put the returned
 * ref on the element whose children are the chunks, and `chunkProps` on each
 * chunk. Chunks get a height estimate until they first render, and scrolling
 * stays anchored when a chunk above the viewport renders taller or shorter
 * than estimated. `childrenKey` must change when the chunks do.
 */
export const useChunkLayout = <T extends HTMLElement>(childrenKey: unknown) => {
  // Every chunk's contents inherit the variable, so setting it restyles all
  // of them: set it at once the first time, then only when resizing stops.
  const setCharsPerLine = useDebouncedCallback(
    (element: HTMLElement, width: number) => {
      element.style.setProperty(
        kCharsPerLine,
        String(measureCharsPerLine(element, width))
      );
    },
    kResizeSettleMs
  );
  const ref = useResizeObserver<T>((entry) => {
    if (!(entry.target instanceof HTMLElement)) {
      return;
    }
    if (entry.target.style.getPropertyValue(kCharsPerLine) === "") {
      entry.target.style.setProperty(
        kCharsPerLine,
        String(measureCharsPerLine(entry.target, entry.contentRect.width))
      );
    } else {
      setCharsPerLine(entry.target, entry.contentRect.width);
    }
  });
  useChildScrollAnchoring(ref, childrenKey);
  return ref;
};

const kCharsPerLine = "--chunk-chars-per-line";
const kResizeSettleMs = 250;

/** Class and style for one chunk of `chars` characters over `lines` lines. */
export const chunkProps = (chars: number, lines: number) => ({
  className: styles.chunk,
  style: cssVars({ "--chunk-chars": chars, "--chunk-lines": lines }),
});

const TextChunks: FC<ChunkedTextProps> = ({ text }) => {
  const ref = useChunkLayout<HTMLSpanElement>(text);
  return (
    <span
      ref={ref}
      className={styles.chunks}
      onCopy={copySelectedSource}
      data-chunk-container
    >
      {splitTextChunks(text).map((chunk, index) => (
        <span key={index} {...chunkProps(chunk.text.length, chunk.lines)}>
          {chunk.text}
        </span>
      ))}
    </span>
  );
};

// A chunk boundary inside a long line is a block boundary, which the browser
// copies as a newline. A selection within the text copies the characters it
// covers instead.
const copySelectedSource = (event: ClipboardEvent<HTMLSpanElement>) => {
  const selection = getSelection();
  if (!selection || selection.rangeCount !== 1) {
    return;
  }
  const range = selection.getRangeAt(0);
  const container = event.currentTarget;
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return;
  }
  event.clipboardData.setData("text/plain", range.toString());
  event.preventDefault();
};

let measureContext: CanvasRenderingContext2D | null | undefined;

// Used when the font can't be measured.
const kDefaultCharsPerLine = 100;

const measureCharsPerLine = (element: Element, width: number): number => {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) {
    return kDefaultCharsPerLine;
  }
  const style = getComputedStyle(element);
  measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const charWidth = measureContext.measureText("0".repeat(100)).width / 100;
  return charWidth > 0
    ? Math.max(1, Math.floor(width / charWidth))
    : kDefaultCharsPerLine;
};
