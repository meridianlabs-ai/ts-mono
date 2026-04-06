import { CSSProperties, ForwardedRef, forwardRef } from "react";

import {
  MarkdownDivWithReferences,
  MarkdownReference,
  Preformatted,
} from "@tsmono/react/components";

import { useDisplayMode } from "./DisplayModeContext";

interface RenderedTextProps {
  markdown: string;
  references?: MarkdownReference[];
  style?: CSSProperties;
  className?: string | string[];
  forceRender?: boolean;
  omitMedia?: boolean;
  omitMath?: boolean;
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
      omitMedia,
      omitMath,
      options,
    },
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
          omitMedia={omitMedia}
          omitMath={omitMath}
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
