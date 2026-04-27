import { CSSProperties, ForwardedRef, forwardRef } from "react";

import {
  MarkdownDivWithReferences,
  MarkdownReference,
  Preformatted,
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
    if (forceRender || displayMode === "rendered") {
      return (
        <MarkdownDivWithReferences
          ref={ref as ForwardedRef<HTMLDivElement>}
          markdown={markdown}
          references={references}
          options={options}
          style={style}
          className={className}
          renderer={renderer}
        />
      );
    } else {
      return (
        <Preformatted
          ref={ref as ForwardedRef<HTMLPreElement>}
          text={markdown}
          style={style}
          className={className}
        />
      );
    }
  }
);

RenderedText.displayName = "RenderedText";
