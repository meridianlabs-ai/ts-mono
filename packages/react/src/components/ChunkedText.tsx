import { ClipboardEvent, FC, useState } from "react";

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

// Used until the container has been measured.
const kDefaultCharsPerLine = 100;

const TextChunks: FC<ChunkedTextProps> = ({ text }) => {
  const [charsPerLine, setCharsPerLine] = useState(kDefaultCharsPerLine);
  const ref = useResizeObserver<HTMLSpanElement>((entry) => {
    setCharsPerLine(measureCharsPerLine(entry.target, entry.contentRect.width));
  });
  return (
    <span
      ref={ref}
      className={styles.chunks}
      style={cssVars({ "--chunk-chars-per-line": charsPerLine })}
      onCopy={copySelectedSource}
    >
      {splitTextChunks(text).map((chunk, index) => (
        <span
          key={index}
          className={styles.chunk}
          style={cssVars({
            "--chunk-chars": chunk.text.length,
            "--chunk-lines": chunk.lines,
          })}
        >
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
