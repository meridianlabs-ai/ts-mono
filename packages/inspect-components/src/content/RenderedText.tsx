import clsx from "clsx";
import { CSSProperties, ForwardedRef, forwardRef } from "react";

import {
  MarkdownDivWithReferences,
  MarkdownReference,
  Preformatted,
  simpleMarkdownTruncate,
  truncationWindow,
  usePlainText,
  type MarkdownRenderer,
} from "@tsmono/react/components";

import { useDisplayMode } from "./DisplayModeContext";

interface RenderedTextProps {
  markdown: string;
  references?: MarkdownReference[];
  style?: CSSProperties;
  className?: string | string[];
  forceRender?: boolean;
  renderer?: MarkdownRenderer;
  /** Show at most about this many characters: markdown-aware when rendered
   *  richly, plain text otherwise (untrusted content is never parsed). */
  truncateAt?: number;
  options?: {
    previewRefsOnHover?: boolean;
  };
}

export const RenderedText = forwardRef<
  HTMLDivElement | HTMLPreElement,
  RenderedTextProps
>(
  (
    {
      markdown,
      references,
      style,
      className,
      forceRender,
      renderer,
      options,
      truncateAt,
    },
    ref
  ) => {
    const displayMode = useDisplayMode();
    const plain = usePlainText();
    const source =
      truncateAt === undefined
        ? markdown
        : truncationWindow(markdown, truncateAt);

    // forceRender overrides the display mode, never content trust.
    if (!plain.trusted || (!forceRender && displayMode !== "rendered")) {
      return (
        <Preformatted
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ForwardedRef is invariant in its element type, so a ref for the union this component forwards can't be handed to either branch's narrower prop; only one branch renders per call
          ref={ref as ForwardedRef<HTMLPreElement>}
          text={plain.present(
            truncateAt === undefined
              ? source
              : simpleMarkdownTruncate(source, truncateAt)
          )}
          style={style}
          className={clsx(className, plain.className)}
        />
      );
    }

    return (
      <MarkdownDivWithReferences
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ForwardedRef is invariant in its element type, so a ref for the union this component forwards can't be handed to either branch's narrower prop; only one branch renders per call
        ref={ref as ForwardedRef<HTMLDivElement>}
        markdown={source}
        references={references}
        options={options}
        style={style}
        className={className}
        renderer={renderer}
        truncateAt={truncateAt}
      />
    );
  }
);

RenderedText.displayName = "RenderedText";
