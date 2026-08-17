import clsx from "clsx";
import { FC, ReactNode } from "react";

import type {
  ToolCallContent,
  ToolCallError,
} from "@tsmono/inspect-common/types";
import { ExpandablePanel } from "@tsmono/react/components";

import { useDisplayMode } from "../../content/DisplayModeContext";
import { defaultContext } from "../MessageContents";

import { AnnotatedScreenshotOutput } from "./AnnotatedScreenshot";
import styles from "./ClientToolCall.module.css";
import { getDefaultCustomToolView } from "./customToolRendering";
import { iconForTool } from "./tool";
import { ToolBlock, ToolBlockInput, ToolBlockOutput } from "./ToolBlock";
import { ToolCallErrorView } from "./ToolCallErrorView";
import { ToolCallView, ToolCallViewProps } from "./ToolCallView";
import { ToolInput } from "./ToolInput";

export interface ClientToolCallProps {
  id: string;
  tool: string;
  /** Header display title; defaults to the tool name. */
  title?: string;
  functionCall: string;
  input?: unknown;
  description?: string;
  contentType?: string;
  view?: ToolCallContent;
  output: ToolCallViewProps["output"];
  selfAnnotation?: ToolCallViewProps["selfAnnotation"];
  inputScreenshot?: ToolCallViewProps["inputScreenshot"];
  error?: ToolCallError;
  className?: string | string[];
  getCustomToolView?: (props: ToolCallViewProps) => ReactNode | undefined;
}

/**
 * A client tool call rendered with the shared tool block grammar: collapsible
 * header (terminal icon · mono tool name · args summary), the input zone
 * (e.g. code) and the output well stacked beneath.
 */
export const ClientToolCall: FC<ClientToolCallProps> = ({
  id,
  tool,
  title,
  functionCall,
  input,
  description,
  contentType,
  view,
  output,
  selfAnnotation,
  inputScreenshot,
  error,
  className,
  getCustomToolView,
}) => {
  const displayMode = useDisplayMode();

  // Custom views render the call and its result as one self-contained UI —
  // give them the block frame without the header.
  const viewProps: ToolCallViewProps = {
    id,
    tool,
    functionCall,
    input,
    description,
    contentType,
    view,
    output,
    selfAnnotation,
    inputScreenshot,
  };
  const customView =
    displayMode === "rendered"
      ? (getCustomToolView?.(viewProps) ?? getDefaultCustomToolView(viewProps))
      : undefined;
  if (customView) {
    return <div className={clsx(styles.custom, className)}>{customView}</div>;
  }

  const hasInput =
    (input !== undefined && input !== null && input !== "") || !!view?.content;
  // Tools without a dedicated input descriptor carry all their args in the
  // functionCall string; args too long for the one-line header summary get a
  // real input zone instead (mirroring ServerToolCall's multi-line args).
  // Gate on the whitespace-collapsed length, not raw newlines: formatArg
  // pretty-prints every object/array value, so even tiny args like
  // `coordinate: [100, 200]` are multi-line as a formatting artifact.
  const argsBody = hasInput ? undefined : fullArgs(functionCall, title || tool);
  const argsSummary = argsBody?.replace(/\s+/g, " ").trim();
  const argsInInputZone = !!argsSummary && argsSummary.length > kMaxSummaryArgs;
  const showError = !!error;
  const showAnnotation = !!selfAnnotation && !!inputScreenshot;
  const showOutput = !showError && (hasOutputContent(output) || showAnnotation);

  return (
    <ToolBlock
      id={id}
      icon={iconForTool(tool)}
      title={title || tool}
      summary={description ?? (argsInInputZone ? undefined : argsSummary)}
      className={className}
    >
      {hasInput || argsInInputZone ? (
        <ToolBlockInput>
          <ExpandablePanel
            id={`${id}-tool-input`}
            collapse={true}
            border={false}
            lines={20}
            className={clsx("text-size-small")}
          >
            <ToolInput
              contentType={hasInput ? contentType : undefined}
              contents={hasInput ? input : argsBody}
              toolCallView={hasInput ? view : undefined}
            />
          </ExpandablePanel>
        </ToolBlockInput>
      ) : null}
      {showError ? (
        <ToolBlockOutput>
          <ToolCallErrorView error={error} />
          {/* A failed action is when seeing where the agent tried to act
              matters most, so the annotated screenshot renders with the
              error rather than being replaced by it. */}
          {selfAnnotation && inputScreenshot ? (
            <AnnotatedScreenshotOutput
              contents={inputScreenshot}
              annotation={selfAnnotation}
              context={defaultContext()}
            />
          ) : null}
        </ToolBlockOutput>
      ) : showOutput ? (
        <ToolBlockOutput>
          <ToolCallView {...viewProps} section="output" />
        </ToolBlockOutput>
      ) : null}
    </ToolBlock>
  );
};

/** Args longer than this can't meaningfully summarize on the single header
 * line; they render in the input zone instead. */
const kMaxSummaryArgs = 120;

/** The args portion of the rendered function call with formatting preserved;
 * collapse whitespace for the single-line header summary. */
const fullArgs = (functionCall: string, tool: string): string | undefined => {
  if (functionCall.startsWith(`${tool}(`) && functionCall.endsWith(")")) {
    const inner = functionCall.slice(tool.length + 1, -1).trim();
    return inner.length > 0 ? inner : undefined;
  }
  return functionCall !== tool ? functionCall : undefined;
};

/** Whether the tool output has anything worth an output well. */
const hasOutputContent = (output: ToolCallViewProps["output"]): boolean => {
  if (output === undefined || output === null) return false;
  if (typeof output === "string") return output.trim().length > 0;
  if (typeof output === "number" || typeof output === "boolean") return true;
  const items = Array.isArray(output) ? output : [output];
  return items.some((item) => {
    if (item.type === "tool") {
      return item.content.some(
        (c) => c.type !== "text" || c.text.trim().length > 0
      );
    }
    if (item.type === "text") {
      return item.text.trim().length > 0;
    }
    return true;
  });
};
