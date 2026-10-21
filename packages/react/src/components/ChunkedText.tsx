import { ClipboardEvent, CSSProperties, FC } from "react";

import { useChildScrollAnchoring } from "../hooks/useChildScrollAnchoring";
import { useResizeObserver } from "../hooks/useResizeObserver";

import styles from "./ChunkedText.module.css";
import {
  kChunkThreshold,
  lineLengths,
  splitTextChunks,
  wrappedRows,
} from "./textChunks";

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
 * Measures how tall `text` lays out in a `pre-wrap` element of a monospace
 * font: a row per line, plus a row per element width's worth of characters a
 * line wraps onto. Wrapping at spaces can take a few more rows than that.
 * Counting is done once per text, so measuring again (at a new width) is
 * cheap.
 */
export const measureTextHeight = (text: string) => {
  const lengths = lineLengths(text);
  return (element: HTMLElement): number =>
    wrappedRows(lengths, measureCharsPerLine(element, element.clientWidth)) *
    lineHeight(element);
};

const lineHeight = (element: HTMLElement): number => {
  const probe = document.createElement("span");
  probe.style.cssText = "display: block; height: 1lh; visibility: hidden";
  element.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
};

const TextChunks: FC<ChunkedTextProps> = ({ text }) => {
  const ref = useResizeObserver<HTMLSpanElement>((entry) => {
    // Measured once: every chunk's contents inherit the variable, so changing
    // it restyles all of them, and re-estimating never-rendered chunks after
    // a resize would swing the whole text's height by the estimate error.
    if (
      entry.target instanceof HTMLElement &&
      entry.contentRect.width > 0 &&
      entry.target.style.getPropertyValue(kCharsPerLine) === ""
    ) {
      entry.target.style.setProperty(
        kCharsPerLine,
        String(measureCharsPerLine(entry.target, entry.contentRect.width))
      );
    }
  });
  useChildScrollAnchoring(ref, text);
  return (
    <span
      ref={ref}
      className={styles.chunks}
      onCopy={copySelectedSource}
      data-chunk-container
    >
      {splitTextChunks(text).map((chunk, index) => (
        <span
          key={index}
          className={styles.chunk}
          style={chunkSize(chunk.text.length, chunk.lines)}
        >
          {chunk.text}
        </span>
      ))}
    </span>
  );
};

const kCharsPerLine = "--chunk-chars-per-line";

// The custom properties a chunk's height estimate reads. csstype declares no
// `--*` properties; React passes these through to the DOM.
const chunkSize = (chars: number, lines: number): CSSProperties => {
  const vars: Record<`--${string}`, number> = {
    "--chunk-chars": chars,
    "--chunk-lines": lines,
  };
  return vars;
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
