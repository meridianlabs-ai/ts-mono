import clsx from "clsx";
import { CSSProperties, ForwardedRef, forwardRef } from "react";

import {
  MarkdownDivWithReferences,
  MarkdownReference,
  Preformatted,
  untrustedText,
  untrustedTextClassName,
  useIsContentTrusted,
  type MarkdownRenderer,
} from "@tsmono/react/components";

import { cappedText } from "./cappedText";
import { useDisplayMode } from "./DisplayModeContext";

interface RenderedTextProps {
  markdown: string;
  references?: MarkdownReference[];
  style?: CSSProperties;
  className?: string | string[];
  forceRender?: boolean;
  renderer?: MarkdownRenderer;
  options?: {
    previewRefsOnHover?: boolean;
  };
}

export const RenderedText = forwardRef<
  HTMLDivElement | HTMLPreElement,
  RenderedTextProps
>(
  (
    { markdown, references, style, className, forceRender, renderer, options },
    ref
  ) => {
    const displayMode = useDisplayMode();
    const trusted = useIsContentTrusted();
    const { text, notice } = cappedText(markdown);

    // forceRender overrides the display mode, never content trust.
    const body =
      trusted && (forceRender || displayMode === "rendered") ? (
        <MarkdownDivWithReferences
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ForwardedRef is invariant in its element type, so a ref for the union this component forwards can't be handed to either branch's narrower prop; only one branch renders per call
          ref={ref as ForwardedRef<HTMLDivElement>}
          markdown={text}
          references={references}
          options={options}
          style={style}
          className={className}
          renderer={renderer}
        />
      ) : (
        <Preformatted
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ForwardedRef is invariant in its element type, so a ref for the union this component forwards can't be handed to either branch's narrower prop; only one branch renders per call
          ref={ref as ForwardedRef<HTMLPreElement>}
          text={trusted ? text : untrustedText(text)}
          style={style}
          className={clsx(className, !trusted && untrustedTextClassName)}
        />
      );

    if (notice === null) {
      return body;
    }

    return (
      <>
        {body}
        {notice}
      </>
    );
  }
);

RenderedText.displayName = "RenderedText";
