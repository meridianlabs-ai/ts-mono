import clsx from "clsx";
import { FC, useRef } from "react";

import type { ToolCallContent } from "@tsmono/inspect-common/types";
import { ContentCode } from "@tsmono/react/components";
import { usePrismHighlight } from "@tsmono/react/hooks";

import { useFormattedContent } from "../../content/DisplayModeContext";
import { RenderedText } from "../../content/RenderedText";

import { kToolTodoContentType } from "./tool";
import { TodoWriteInput } from "./tool-input/TodoWriteInput";
import styles from "./ToolInput.module.css";

interface ToolInputProps {
  contentType?: string;
  contents?: unknown;
  toolCallView?: ToolCallContent;
  className?: string | string[];
}
export const ToolInput: FC<ToolInputProps> = (props) => {
  const { contentType, contents, toolCallView, className } = props;
  const formatContent = useFormattedContent();

  const sourceCodeRef = useRef<HTMLDivElement | null>(null);
  const useToolView =
    formatContent && toolCallView && isValidView(toolCallView);

  const serialized = useToolView
    ? undefined
    : typeof contents === "string"
      ? contents
      : JSON.stringify(contents);
  usePrismHighlight(
    sourceCodeRef,
    useToolView ? toolCallView.content.length : (serialized?.length ?? 0)
  );

  if (useToolView) {
    return (
      <RenderedText
        markdown={toolCallView.content || ""}
        ref={sourceCodeRef}
        className={clsx("tool-call-input", styles.toolView, className)}
      />
    );
  }
  if (serialized === undefined) return null;

  if (contentType === kToolTodoContentType && formatContent) {
    return <TodoWriteInput contents={contents} parentRef={sourceCodeRef} />;
  }

  return (
    <div ref={sourceCodeRef}>
      <pre className={clsx("tool-call-input", styles.outputPre, className)}>
        <ContentCode
          className={clsx(
            "source-code",
            "sourceCode",
            contentType ? `language-${contentType}` : undefined,
            styles.outputCode
          )}
          text={serialized}
        />
      </pre>
    </div>
  );
};

// Guard against invalid tool views (e.g., malformed bash tool content
// from older log files).
const isValidView = (view: ToolCallContent): boolean => {
  if (view.content === "```bash\nbash\n```\n") {
    return false;
  }
  return true;
};
