import { FC, ReactNode } from "react";

import {
  MarkdownDivWithReferences,
  MarkdownReference,
} from "@tsmono/react/components";

import { ScanResultSummary } from "../types";

interface ExplanationProps {
  summary?: ScanResultSummary;
  references?: MarkdownReference[];
  options?: {
    previewRefsOnHover?: boolean;
  };
}

export const Explanation: FC<ExplanationProps> = ({
  summary,
  references,
  options,
}): ReactNode => {
  return (
    <MarkdownDivWithReferences
      markdown={summary?.explanation || ""}
      references={references}
      options={options}
    />
  );
};
