import clsx from "clsx";
import {
  CSSProperties,
  forwardRef,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useState,
} from "react";

import "./MarkdownDiv.css";

import { onDemandModule } from "../hooks/onDemandModule";

import { usePlainText } from "./ContentTrust";
import { useHasAllContentPermissions } from "./ContentTrustContext";
import {
  defaultMarkdownRenderer,
  escapeHtmlCharacters,
  simpleMarkdownTruncate,
  truncationWindow,
  type MarkdownRenderer,
} from "./markdownText";

export type { MarkdownRenderer } from "./markdownText";

// The markdown pipeline (markdown-it, DOMPurify, MathJax) loads on first
// trusted render, so none of it is fetched or run for untrusted content.
const markdownPipeline = onDemandModule(() => import("./markdownPipeline"));

interface MarkdownDivProps {
  markdown: string;
  renderer?: MarkdownRenderer;
  /** Show at most about this many characters: markdown-aware for trusted
   *  content, plain text for untrusted content (which is never parsed). */
  truncateAt?: number;
  style?: CSSProperties;
  className?: string | string[];
  postProcess?: (html: string) => string;
  onClick?: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}

const sanitizeMarkdown = (md: string): string => {
  return escapeHtmlCharacters(md).replace(/\n/g, "<br/>");
};

const MarkdownDivComponent = forwardRef<HTMLDivElement, MarkdownDivProps>(
  (props, ref) => {
    // Rendered markdown can carry links, media, math and highlighted code.
    // Until the pipeline enforces those permissions individually, it runs
    // only when all of them are granted.
    const trusted = useHasAllContentPermissions();
    // Truncation reads only this much, so it's all that's rendered or cached.
    const markdown =
      props.truncateAt === undefined
        ? props.markdown
        : truncationWindow(props.markdown, props.truncateAt);
    return trusted ? (
      <RichMarkdownDiv {...props} markdown={markdown} ref={ref} />
    ) : (
      <UntrustedMarkdownDiv {...props} markdown={markdown} ref={ref} />
    );
  }
);

MarkdownDivComponent.displayName = "MarkdownDivComponent";

/**
 * Untrusted markdown is never parsed: it's shown as its source text. There
 * are no anchors to delegate clicks for, so `onClick` is not wired.
 */
const UntrustedMarkdownDiv = forwardRef<HTMLDivElement, MarkdownDivProps>(
  ({ markdown, truncateAt, style, className }, ref) => {
    const plain = usePlainText();
    return (
      <div
        ref={ref}
        style={style}
        className={clsx(className, "untrusted-content", plain.className)}
      >
        {plain.present(
          truncateAt === undefined
            ? markdown
            : simpleMarkdownTruncate(markdown, truncateAt)
        )}
      </div>
    );
  }
);

UntrustedMarkdownDiv.displayName = "UntrustedMarkdownDiv";

const RichMarkdownDiv = forwardRef<HTMLDivElement, MarkdownDivProps>(
  (
    { markdown, renderer, truncateAt, style, className, postProcess, onClick },
    ref
  ) => {
    const rendererName = renderer ?? defaultMarkdownRenderer;

    // Check cache for sanitized rendered content (before post-processing)
    const cacheKey = `${rendererName}:${truncateAt ?? ""}:${markdown}`;
    const cachedHtml = renderCache.get(cacheKey);

    // Shown until the pipeline renders: the (plainly truncated) source.
    const placeholder = sanitizeMarkdown(
      truncateAt === undefined
        ? markdown
        : simpleMarkdownTruncate(markdown, truncateAt)
    );

    // Apply post-processing to get final HTML. The sanitizer runs after
    // post-processing because injected reference links are HTML too.
    const applyPostProcess = useCallback(
      (html: string): string => {
        // Rendered html (and so a cache hit) implies the pipeline is loaded.
        const pipeline = markdownPipeline.loaded();
        if (!postProcess || !pipeline) {
          return html;
        }
        return pipeline.sanitizeRenderedHtml(postProcess(html));
      },
      [postProcess]
    );

    // Initialize with content (cached or unrendered markdown)
    const [renderedHtml, setRenderedHtml] = useState<string>(() => {
      if (cachedHtml) {
        return applyPostProcess(cachedHtml);
      }
      return placeholder;
    });

    // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
    useEffect(() => {
      // If already cached, apply post-processing and use cached content
      if (cachedHtml) {
        const finalHtml = applyPostProcess(cachedHtml);
        startTransition(() => {
          // Functional update keeps renderedHtml out of the effect deps,
          // avoiding cancel/re-enqueue churn on every async completion
          setRenderedHtml((prev) => (prev === finalHtml ? prev : finalHtml));
        });
        return;
      }

      // Reset to sanitized markdown text when markdown changes (keep this synchronous for immediate feedback)
      setRenderedHtml(placeholder);

      const { promise, cancel } = renderQueue.enqueue(async () => {
        const loaded = await markdownPipeline.load();
        const source =
          truncateAt === undefined
            ? markdown
            : loaded.truncateMarkdown(markdown, truncateAt);
        return loaded.sanitizeRenderedHtml(
          await loaded.renderMarkdown(source, rendererName)
        );
      });

      promise
        .then((sanitizedResult) => {
          if (renderCache.size >= MAX_CACHE_SIZE) {
            const firstKey = renderCache.keys().next().value;
            if (firstKey) {
              renderCache.delete(firstKey);
            }
          }
          renderCache.set(cacheKey, sanitizedResult);
          // React 18 batches same-turn transition updates, so concurrent
          // completions still coalesce into a single render pass.
          startTransition(() => {
            setRenderedHtml(applyPostProcess(sanitizedResult));
          });
        })
        .catch((error: unknown) => {
          console.error("Markdown rendering error:", error);
        });

      return () => {
        // Cancel rendering if component unmounts
        cancel();
      };
    }, [
      markdown,
      rendererName,
      truncateAt,
      placeholder,
      cachedHtml,
      cacheKey,
      applyPostProcess,
    ]);

    return (
      // The container is not itself a control: onClick delegates for the
      // anchors inside the rendered markdown, which already fire click on
      // Enter, so no separate key handler is needed.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div
        ref={ref}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
        style={style}
        className={clsx(className, "markdown-content")}
        onClick={onClick}
      />
    );
  }
);

RichMarkdownDiv.displayName = "RichMarkdownDiv";

// Memoize component to prevent re-renders when props haven't changed
export const MarkdownDiv = memo(MarkdownDivComponent);

// Cache for rendered markdown to avoid re-processing identical content
const renderCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

// Markdown rendering queue to make markdown rendering async while limiting concurrency
interface QueueTask {
  task: () => Promise<void>;
  cancelled: boolean;
}

// Exported for tests only
export class MarkdownRenderQueue {
  private queue: QueueTask[] = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue<T>(task: () => T | Promise<T>): {
    promise: Promise<T>;
    cancel: () => void;
  } {
    let cancelled = false;
    let queueTask: QueueTask | undefined;

    const promise = new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        // Skip if cancelled before execution
        if (cancelled) {
          return;
        }

        try {
          const result = await task();
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!cancelled) {
            resolve(result);
          }
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!cancelled) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
      };

      queueTask = {
        task: wrappedTask,
        cancelled: false,
      };

      this.queue.push(queueTask);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.processQueue();
    });

    const cancel = () => {
      cancelled = true;
      // Mark our own task so processQueue skips it without running it
      if (queueTask) {
        queueTask.cancelled = true;
      }
    };

    return { promise, cancel };
  }

  private async processQueue(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    // Find next non-cancelled task
    let queueTask: QueueTask | undefined;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task && !task.cancelled) {
        queueTask = task;
        break;
      }
    }

    if (!queueTask) {
      return;
    }

    this.activeCount++;

    try {
      await queueTask.task();
    } finally {
      this.activeCount--;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.processQueue();
    }
  }
}

// Shared rendering queue
const renderQueue = new MarkdownRenderQueue(10);
