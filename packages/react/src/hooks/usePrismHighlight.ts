import { RefObject, useLayoutEffect } from "react";

import {
  kUntrustedContentSelector,
  useIsContentTrusted,
} from "../components/ContentTrust";

import { onDemandModule } from "./onDemandModule";

// Syntax highlighting strings larger than this is too slow
const kPrismRenderMaxSize = 250000;

type Highlighter = typeof import("./prismHighlighter");

// Prism loads on first use, so it's never fetched for untrusted content.
const prism = onDemandModule(() => import("./prismHighlighter"));

const highlightCodeBlocks = (
  container: HTMLElement,
  highlightElement: Highlighter["highlightElement"]
) => {
  const codeBlocks = container.querySelectorAll("pre code");
  codeBlocks.forEach((block) => {
    // Skip already highlighted blocks, and never highlight untrusted content
    // (even if an observer outlives the trust that started it).
    if (
      block.hasAttribute("data-highlighted") ||
      block.closest(kUntrustedContentSelector) !== null
    ) {
      return;
    }
    if (block.className.includes("language-")) {
      block.classList.add("sourceCode");
      highlightElement(block);
      block.setAttribute("data-highlighted", "true");
    }
  });
};

export const usePrismHighlight = (
  containerRef: RefObject<HTMLDivElement | null>,
  contentLength: number
) => {
  const trusted = useIsContentTrusted();
  // A layout effect, so revoking trust disconnects the observer in the same
  // commit that inserts the untrusted content; a passive effect's cleanup can
  // run after the observer has already seen (and highlighted) it.
  useLayoutEffect(() => {
    if (
      !trusted ||
      contentLength <= 0 ||
      containerRef.current === null ||
      contentLength > kPrismRenderMaxSize
    ) {
      return;
    }

    const container = containerRef.current;
    let cancelled = false;
    let frame: number | undefined;
    let observer: MutationObserver | undefined;

    void prism
      .load()
      .then(({ highlightElement }) => {
        if (cancelled) {
          return;
        }

        // Immediate highlight attempt
        frame = requestAnimationFrame(() => {
          highlightCodeBlocks(container, highlightElement);
        });

        // MutationObserver for async-rendered content (e.g., MarkdownDiv)
        observer = new MutationObserver((mutations) => {
          // Check if any mutation added code blocks
          const hasNewCodeBlocks = mutations.some((mutation) => {
            if (mutation.type === "childList") {
              return Array.from(mutation.addedNodes).some((node) => {
                if (node instanceof Element) {
                  return (
                    node.querySelector("pre code") || node.matches("pre code")
                  );
                }
                return false;
              });
            }
            return false;
          });

          if (hasNewCodeBlocks) {
            highlightCodeBlocks(container, highlightElement);
          }
        });

        observer.observe(container, {
          childList: true,
          subtree: true,
        });
      })
      .catch((error: unknown) => {
        console.error("Unable to load syntax highlighting", error);
      });

    return () => {
      cancelled = true;
      // A trust change must stop highlighting already queued while trusted.
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
    };
  }, [contentLength, containerRef, trusted]);
};
