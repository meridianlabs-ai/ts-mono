import { RefObject, useEffect } from "react";

import { useIsContentTrusted } from "../components/ContentTrust";

// Syntax highlighting strings larger than this is too slow
const kPrismRenderMaxSize = 250000;

type Highlighter = typeof import("./prismHighlighter");

// Prism loads on first use, so it's never fetched for untrusted content.
let highlighterPromise: Promise<Highlighter> | null = null;
const loadHighlighter = (): Promise<Highlighter> => {
  if (!highlighterPromise) {
    const loading = import("./prismHighlighter");
    // Reset on rejection so a transient chunk-load failure retries next time.
    loading.catch(() => {
      if (highlighterPromise === loading) {
        highlighterPromise = null;
      }
    });
    highlighterPromise = loading;
  }
  return highlighterPromise;
};

const highlightCodeBlocks = (
  container: HTMLElement,
  highlightElement: Highlighter["highlightElement"]
) => {
  const codeBlocks = container.querySelectorAll("pre code");
  codeBlocks.forEach((block) => {
    // Skip already highlighted blocks
    if (block.hasAttribute("data-highlighted")) {
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
  useEffect(() => {
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
    let observer: MutationObserver | undefined;

    void loadHighlighter()
      .then(({ highlightElement }) => {
        if (cancelled) {
          return;
        }

        // Immediate highlight attempt
        requestAnimationFrame(() => {
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
      observer?.disconnect();
    };
  }, [contentLength, containerRef, trusted]);
};
