import { FC, ReactNode, useRef } from "react";

import { usePlainText } from "@tsmono/react/components";
import { scrollingAncestor, useCollapsedState } from "@tsmono/react/hooks";

import styles from "./cappedText.module.css";

// Beyond this size, rendering text richly or as a single DOM node produces an
// element tens-of-thousands to millions of pixels tall. The browser then lays
// out, paints, and (most expensively) *layerizes* that whole node on every
// resize — a single resize of a ~1,000,000px node was measured at ~14s of
// `Layerize`, wedging the main thread (laggy in Blink, spinlocks WebKit). So
// only a head slice renders as usual; the reader can ask for the whole text,
// which renders as plain text in content-visibility chunks.
export const kMaxInlineChars = 250_000;

interface CappedTextProps {
  text: string;
  /** Renders `text`, or its first `kMaxInlineChars` characters, as usual. */
  render: (text: string) => ReactNode;
  /** Renders the whole text, already prepared for display, as plain text in
   *  a `pre-wrap` element: through `Preformatted` or `ChunkedText`. */
  renderPlain: (text: string) => ReactNode;
  /** The text as the reader sees it in plain text, when they ask for all of
   *  it; the text as-is by default. */
  toPlainText?: (text: string) => string;
}

/**
 * Renders text up to `kMaxInlineChars` characters as usual. Past that, renders
 * the head with a notice offering the whole text as plain text, and remembers
 * the reader's choice for that text.
 */
export const CappedText: FC<CappedTextProps> = (props) =>
  props.text.length > kMaxInlineChars ? (
    <LongText {...props} />
  ) : (
    props.render(props.text)
  );

const LongText: FC<CappedTextProps> = ({
  text,
  render,
  renderPlain,
  toPlainText = (full) => full,
}) => {
  const [headOnly, setHeadOnly] = useCollapsedState(
    textKey(text),
    true,
    "capped-text"
  );
  const plain = usePlainText();
  const fullRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const head = text.slice(0, kMaxInlineChars);

  const toggle = () => {
    const notice = noticeRef.current;
    const scroller = notice && scrollingAncestor(notice);
    if (scroller) {
      const top = notice.getBoundingClientRect().top;
      // Showing all of it: the text that was hidden starts where the notice
      // was. Showing the head again: the notice returns to where it is now.
      const hiddenStart = plain.present(toPlainText(head)).length;
      keepInPlace(
        scroller,
        headOnly
          ? () => fullRef.current && offsetTop(fullRef.current, hiddenStart)
          : () => noticeRef.current?.getBoundingClientRect().top,
        top
      );
    }
    setHeadOnly(!headOnly);
  };

  return (
    <>
      {headOnly ? (
        render(head)
      ) : (
        <div ref={fullRef}>{renderPlain(plain.present(toPlainText(text)))}</div>
      )}
      <div ref={noticeRef} className={styles.notice}>
        {headOnly
          ? `Showing the first ${count(kMaxInlineChars)} of ${count(text.length)} characters.`
          : `Showing all ${count(text.length)} characters as plain text.`}{" "}
        <button type="button" className={styles.toggle} onClick={toggle}>
          {headOnly ? "Show all" : `Show the first ${count(kMaxInlineChars)}`}
        </button>
      </div>
    </>
  );
};

const count = (n: number): string => n.toLocaleString();

// Identifies a text for remembering the reader's choice, without hashing
// megabytes on every render: its length and its two ends.
const textKey = (text: string): string => {
  let hash = 0x811c9dc5;
  for (const part of [text.slice(0, 1_000), text.slice(-1_000)]) {
    for (let i = 0; i < part.length; i++) {
      hash = Math.imul(hash ^ part.charCodeAt(i), 0x01000193);
    }
  }
  return `${text.length}-${(hash >>> 0).toString(16)}`;
};

// Over the next frames, scrolls so the located point stays at `top`: the
// swapped text's chunks lay out and the list around it remeasures over
// several frames, each of which can move it. Positions are relative to the
// scroller, which itself can move (a header collapsing as it scrolls). Stops
// once the reader scrolls.
const keepInPlace = (
  scroller: HTMLElement,
  locate: () => number | null | undefined,
  top: number
) => {
  const offset = top - scroller.getBoundingClientRect().top;
  const readerScrolls = new AbortController();
  for (const type of ["wheel", "touchmove", "keydown"]) {
    scroller.addEventListener(type, () => readerScrolls.abort(), {
      signal: readerScrolls.signal,
    });
  }
  let frames = 0;
  let settled = 0;
  const step = () => {
    const now = readerScrolls.signal.aborted ? undefined : locate();
    if (now === null || now === undefined) {
      readerScrolls.abort();
      return;
    }
    const delta = now - scroller.getBoundingClientRect().top - offset;
    if (Math.abs(delta) >= 1) {
      scroller.scrollTop += delta;
      settled = 0;
    } else {
      settled++;
    }
    frames++;
    if (settled < 2 && frames < kPlaceFrames) {
      requestAnimationFrame(step);
    } else {
      readerScrolls.abort();
    }
  };
  requestAnimationFrame(step);
};

const kPlaceFrames = 30;

// The viewport y of the character at `offset` in `root`'s text.
const offsetTop = (root: Element, offset: number): number | undefined => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let start = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) {
      continue;
    }
    if (offset < start + node.length) {
      const range = document.createRange();
      range.setStart(node, offset - start);
      range.setEnd(node, offset - start + 1);
      return range.getBoundingClientRect().top;
    }
    start += node.length;
  }
  return undefined;
};
