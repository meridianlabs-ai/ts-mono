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

import {
  defaultMarkdownRenderer,
  escapeHtmlCharacters,
  renderMarkdown,
  type MarkdownRenderer,
} from "./markdownRendering";

export type { MarkdownRenderer } from "./markdownRendering";

interface MarkdownDivProps {
  markdown: string;
  renderer?: MarkdownRenderer;
  style?: CSSProperties;
  className?: string | string[];
  postProcess?: (html: string) => string;
  onClick?: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}

const sanitizeMarkdown = (md: string): string => {
  return escapeHtmlCharacters(md).replace(/\n/g, "<br/>");
};

const MarkdownDivComponent = forwardRef<HTMLDivElement, MarkdownDivProps>(
  ({ markdown, renderer, style, className, postProcess, onClick }, ref) => {
    const rendererName = renderer ?? defaultMarkdownRenderer;

    // Check cache for rendered content (before post-processing)
    const cacheKey = `${rendererName}:${markdown}`;
    const cachedHtml = renderCache.get(cacheKey);

    // Apply post-processing to get final HTML
    const applyPostProcess = useCallback(
      (html: string): string => {
        return postProcess ? postProcess(html) : html;
      },
      [postProcess]
    );

    // Initialize with content (cached or unrendered markdown)
    const [renderedHtml, setRenderedHtml] = useState<string>(() => {
      if (cachedHtml) {
        return applyPostProcess(cachedHtml);
      }
      return sanitizeMarkdown(markdown);
    });

    useEffect(() => {
      // If already cached, apply post-processing and use cached content
      if (cachedHtml) {
        const finalHtml = applyPostProcess(cachedHtml);
        // Only update state if it's different (avoid unnecessary re-render)
        if (renderedHtml !== finalHtml) {
          startTransition(() => {
            setRenderedHtml(finalHtml);
          });
        }
        return;
      }

      // Reset to sanitized markdown text when markdown changes (keep this synchronous for immediate feedback)
      setRenderedHtml(sanitizeMarkdown(markdown));

      const { cancel } = renderCoordinator.enqueue(
        () => renderMarkdown(markdown, rendererName),
        (result) => {
          if (renderCache.size >= MAX_CACHE_SIZE) {
            const firstKey = renderCache.keys().next().value;
            if (firstKey) {
              renderCache.delete(firstKey);
            }
          }
          renderCache.set(cacheKey, result);
          setRenderedHtml(applyPostProcess(result));
        }
      );

      return () => {
        // Cancel rendering if component unmounts
        cancel();
      };
      // The effect must re-run only when source inputs change, not when its own
      // async output updates; reading current renderedHtml in the cached branch
      // without subscribing here is intentional.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes renderedHtml; see comment above
    }, [markdown, rendererName, cachedHtml, cacheKey, applyPostProcess]);

    return (
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

MarkdownDivComponent.displayName = "MarkdownDivComponent";

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

class MarkdownRenderQueue {
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

    const promise = new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        // Skip if cancelled before execution
        if (cancelled) {
          return;
        }

        try {
          const result = await task();
          if (!cancelled) {
            resolve(result);
          }
        } catch (error) {
          if (!cancelled) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
      };

      const queueTask: QueueTask = {
        task: wrappedTask,
        cancelled: false,
      };

      this.queue.push(queueTask);
      void this.processQueue();
    });

    const cancel = () => {
      cancelled = true;
      // Mark task as cancelled in queue
      const index = this.queue.findIndex((t) => !t.cancelled);
      if (index !== -1 && this.queue[index]) {
        this.queue[index].cancelled = true;
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
      void this.processQueue();
    }
  }
}

class MarkdownRenderCoordinator {
  private nextId = 0;
  private completedResults = new Map<number, string>();
  private pendingCallbacks = new Map<number, (html: string) => void>();
  private flushScheduled = false;
  private queue: MarkdownRenderQueue;

  constructor(maxConcurrent: number = 10) {
    this.queue = new MarkdownRenderQueue(maxConcurrent);
  }

  enqueue(
    task: () => Promise<string>,
    onComplete: (html: string) => void
  ): { cancel: () => void } {
    const id = this.nextId++;
    this.pendingCallbacks.set(id, onComplete);

    const { promise, cancel } = this.queue.enqueue(task);

    promise
      .then((result) => {
        this.completedResults.set(id, result);
        this.scheduleFlush();
      })
      .catch((error: unknown) => {
        this.pendingCallbacks.delete(id);
        this.completedResults.delete(id);
        console.error("Markdown rendering error:", error);
      });

    return {
      cancel: () => {
        cancel();
        this.pendingCallbacks.delete(id);
        this.completedResults.delete(id);
      },
    };
  }

  private scheduleFlush(): void {
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = new Map(this.completedResults);
    this.completedResults.clear();

    if (batch.size === 0) {
      return;
    }

    startTransition(() => {
      for (const [id, html] of batch) {
        const callback = this.pendingCallbacks.get(id);
        if (callback) {
          callback(html);
          this.pendingCallbacks.delete(id);
        }
      }
    });
  }
}

const renderCoordinator = new MarkdownRenderCoordinator(10);
