import { FC, ReactNode, RefObject, useRef } from "react";
import { flushSync } from "react-dom";

import {
  findScrollableParent,
  measureTextHeight,
  usePlainText,
} from "@tsmono/react/components";
import {
  useCollapsedState,
  useLatestRef,
  useMountEffect,
  useProperty,
  useResizeObserver,
} from "@tsmono/react/hooks";

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
   *  it; the text as-is by default. It is also applied to the head to find
   *  where the hidden text starts, so it must map a prefix of the text to a
   *  prefix of the result (no trimming the end). */
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
  // Shared like the choice, so no copy of the text keeps offering it.
  const [tooTall, setTooTall] = useProperty<boolean>(
    "capped-text-too-tall",
    textKey(text),
    { defaultValue: false }
  );
  const plain = usePlainText();
  const fullRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const measured = useRef<{
    text: string;
    measure: (element: HTMLElement) => number;
    layout: string;
    height: number;
  } | null>(null);
  const head = text.slice(0, kMaxInlineChars);
  const showHead = headOnly || tooTall;

  // Whether all of the text, laid out in `view`, ends where the browser can
  // still lay it out: past its limit, the end of the text and everything
  // after it can't be scrolled to.
  const fits = (view: HTMLElement): boolean => {
    const container = textContainer(view);
    if (measured.current?.text !== text) {
      measured.current = {
        text,
        measure: measureTextHeight(plain.present(toPlainText(text))),
        layout: "",
        height: 0,
      };
    }
    // Measured again only for a new width or font size.
    const layout = layoutKey(container);
    if (measured.current.layout !== layout) {
      measured.current.layout = layout;
      measured.current.height = measured.current.measure(container);
    }
    return contentTop(container) + measured.current.height <= maxTextBottom();
  };

  // Synchronously, so the text that doesn't fit is never painted.
  const giveUp = () => {
    const focused = noticeRef.current?.contains(document.activeElement);
    flushSync(() => {
      setTooTall(true);
      setHeadOnly(true);
    });
    // The focused toggle is gone.
    if (focused) {
      noticeRef.current?.focus({ preventScroll: true });
    }
  };

  // Whether the shown text still fits, going back to the head when not.
  const check = (view: HTMLElement): boolean => {
    if (fits(view)) {
      return true;
    }
    giveUp();
    return false;
  };

  const toggle = () => {
    const notice = noticeRef.current;
    const scroller =
      notice && findScrollableParent(notice, { minScrollBuffer: 0 });
    const top = notice?.getBoundingClientRect().top;
    // Committed now so the new layout can be measured and adjusted before it
    // paints.
    flushSync(() => setHeadOnly(!headOnly));
    if (headOnly) {
      const view = fullRef.current;
      if (view && !fits(view)) {
        giveUp();
        return;
      }
      // Everything after this text moved down.
      recheckFullTexts();
    }
    if (scroller && top !== undefined) {
      // Showing all of it: the text that was hidden starts where the notice
      // was. Showing the head again: the notice returns to where it was.
      const hiddenStart = plain.present(toPlainText(head)).length;
      keepInPlace(
        scroller,
        headOnly
          ? () => fullRef.current && offsetTop(fullRef.current, hiddenStart)
          : () => noticeRef.current?.getBoundingClientRect().top,
        top
      );
    }
  };

  return (
    <>
      {showHead ? (
        render(head)
      ) : (
        <FullText ref={fullRef} check={check}>
          {renderPlain(plain.present(toPlainText(text)))}
        </FullText>
      )}
      <div ref={noticeRef} className={styles.notice} tabIndex={-1}>
        {showHead
          ? `Output truncated — ${hidden(text.length - head.length)}.`
          : "Showing all as plain text."}
        {tooTall ? (
          " Too long to show in full."
        ) : (
          <>
            {" "}
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={!headOnly}
              onClick={toggle}
            >
              {headOnly ? "Show all" : "Truncate"}
            </button>
          </>
        )}
      </div>
    </>
  );
};

const textContainer = (view: HTMLElement): HTMLElement =>
  view.querySelector<HTMLElement>("[data-chunk-container]") ?? view;

// What the measured height depends on besides the text.
const layoutKey = (container: HTMLElement): string =>
  `${container.clientWidth} ${getComputedStyle(container).fontSize}`;

// How far down its scroll content `element` starts.
const contentTop = (element: HTMLElement): number => {
  const scroller = findScrollableParent(element, { minScrollBuffer: 0 });
  return scroller
    ? element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop
    : element.getBoundingClientRect().top + window.scrollY;
};

// How far down its scroll content the full text may end. Browsers clamp or
// overflow positions and sizes past a limit (33,554,432px in Chromium, about
// 17,895,697 in Firefox, where a taller element lays out as 0). Probed once: a
// browser that lays out a 30M px element allows 28M, any other 15M. Both
// leave room for wrapping at spaces, which took up to 9% more rows than
// measured on long lines.
let maxBottom: number | undefined;
const maxTextBottom = (): number => {
  if (maxBottom === undefined) {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position: absolute; visibility: hidden; height: 30000000px";
    document.body.appendChild(probe);
    maxBottom =
      probe.getBoundingClientRect().height >= 30_000_000
        ? 28_000_000
        : 15_000_000;
    probe.remove();
  }
  return maxBottom;
};

// Its own component so its resize observer attaches when it mounts.
// Rechecks the text when it resizes (a new width or font size) and, for a
// few frames after, while the list around it settles: a list moves its rows
// without resizing them, so a move down past the limit isn't observed.
const FullText: FC<{
  ref: RefObject<HTMLDivElement | null>;
  check: (view: HTMLElement) => boolean;
  children: ReactNode;
}> = ({ ref, check, children }) => {
  const watching = useRef(false);
  const watch = (view: HTMLElement) => {
    if (watching.current || !check(view)) {
      return;
    }
    watching.current = true;
    let top = view.getBoundingClientRect().top;
    let still = 0;
    let frames = 0;
    const step = () => {
      const now = view.getBoundingClientRect().top;
      still = now === top ? still + 1 : 0;
      top = now;
      frames++;
      if (
        view.isConnected &&
        check(view) &&
        still < kSettledFrames &&
        frames < kMaxWatchFrames
      ) {
        requestAnimationFrame(step);
      } else {
        watching.current = false;
      }
    };
    requestAnimationFrame(step);
  };
  useResizeObserver((entry) => {
    if (entry.target instanceof HTMLElement) {
      watch(entry.target);
    }
  }, ref);
  const latestWatch = useLatestRef(watch);
  useMountEffect(() => {
    const recheck = () => {
      if (ref.current) {
        latestWatch.current(ref.current);
      }
    };
    fullTextRechecks.add(recheck);
    return () => {
      fullTextRechecks.delete(recheck);
    };
  });
  return <div ref={ref}>{children}</div>;
};

const kSettledFrames = 3;
const kMaxWatchFrames = 60;

// Every mounted full text's recheck, run when another one expands.
const fullTextRechecks = new Set<() => void>();
const recheckFullTexts = () => {
  for (const recheck of fullTextRechecks) {
    recheck();
  }
};

const hidden = (n: number): string =>
  `${n.toLocaleString(navigator.language, {
    notation: "compact",
    maximumFractionDigits: 1,
  })} ${n === 1 ? "character" : "characters"} hidden`;

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

// Now and over the next frames, scrolls so the located point stays at `top`:
// the swapped text's chunks lay out and the list around it remeasures over
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
  // pointerdown covers dragging the scrollbar.
  for (const type of ["wheel", "touchmove", "keydown", "pointerdown"]) {
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
  step();
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
      const top = range.getBoundingClientRect().top;
      // Safari reports a stale position for text in a chunk it hasn't laid
      // out yet: go by the chunk instead, as far down as the character is,
      // which brings it on screen to be laid out.
      const chunk = node.parentElement?.getBoundingClientRect();
      if (chunk && (top < chunk.top || top > chunk.bottom)) {
        return chunk.top + ((offset - start) / node.length) * chunk.height;
      }
      return top;
    }
    start += node.length;
  }
  return undefined;
};
