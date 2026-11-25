import { ReactNode } from "react";

import { MarkdownReference } from "@tsmono/react/components";

export const Buckets = {
  first: 0,
  intermediate: 10,
  final: 1000,
};

export interface RenderOptions {
  renderString: "pre" | "markdown";
  previewRefsOnHover?: boolean;
}

export interface RenderEntry {
  name: string;
  value: unknown;
}

export interface ContentRenderer {
  bucket: number;
  /** Returns undefined when the entry isn't this renderer's kind. */
  render: (
    id: string,
    entry: RenderEntry,
    options: RenderOptions,
    references?: MarkdownReference[]
  ) => { rendered: ReactNode } | undefined;
}
