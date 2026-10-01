import clsx from "clsx";
import { FC, ReactNode } from "react";

import type { ContentToolUse } from "@tsmono/inspect-common/types";
import { ContentText, ExpandablePanel } from "@tsmono/react/components";
import { asJsonObjArray, isJson, isRecord } from "@tsmono/util";

import { useFormattedData } from "../../content/DisplayModeContext";
import { ExternalLink } from "../../content/ExternalLink";
import { RecordTree } from "../../content/RecordTree";
import { RenderedContent } from "../../content/RenderedContent";
import { iconForTool } from "../tools/tool";
import { ToolBlock, ToolBlockInput, ToolBlockOutput } from "../tools/ToolBlock";
import { ToolCallErrorView } from "../tools/ToolCallErrorView";
import { ToolInput } from "../tools/ToolInput";

import styles from "./ServerToolCall.module.css";

interface ServerToolCallProps {
  id?: string;
  content: ContentToolUse;
  /** Flush rows stack inside the assistant turn container; standalone
   * renders carry their own frame (border + radius). */
  flush?: boolean;
  className?: string | string[];
}

/**
 * Renders a server-side tool call (web_search, web_fetch, provider-executed
 * MCP tools) as a flush row of the assistant turn: the shared tool block
 * grammar with a globe icon and a neutral "server" pill as the only server
 * signals.
 */
export const ServerToolCall: FC<ServerToolCallProps> = ({
  id,
  content,
  flush = true,
  className,
}) => {
  const formatted = useFormattedData();
  const args = formatted ? resolveArgs(content) : {};
  const summaryArgs: Record<string, unknown> = {};
  const inputArgs: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.includes("\n")) {
      inputArgs.push([key, value]);
    } else {
      summaryArgs[key] = value;
    }
  }
  const input = formatted ? (
    inputArgs.map(([key, value]) => (
      <ToolInput
        key={key}
        contentType={
          content.tool_type === "code_execution" ? "python" : undefined
        }
        contents={value}
      />
    ))
  ) : content.arguments.length > 0 ? (
    <ToolInput contents={content.arguments} />
  ) : null;
  const hasInput = formatted ? inputArgs.length > 0 : input !== null;
  const output = formatted ? (
    formattedServerResult(id, content)
  ) : content.result.length > 0 ? (
    <ExpandablePanel
      id={`${id}-output`}
      collapse={true}
      border={false}
      lines={15}
    >
      <RenderedContent
        id={`${id}-output`}
        entry={{ name: "Output", value: content.result }}
        renderOptions={{ renderString: "pre" }}
      />
    </ExpandablePanel>
  ) : null;

  return (
    <ToolBlock
      id={id}
      flush={flush}
      className={className}
      icon={iconForTool(content.name, { server: true })}
      title={
        content.context ? `${content.context} — ${content.name}` : content.name
      }
      summary={formatted ? argsSummary(summaryArgs) : undefined}
      pill="server"
    >
      {hasInput && (
        <ToolBlockInput>
          <ExpandablePanel
            id={`${id}-input`}
            collapse={true}
            border={false}
            lines={20}
            className={formatted ? "text-size-small" : undefined}
          >
            {input}
          </ExpandablePanel>
        </ToolBlockInput>
      )}
      {(content.error || output !== null) && (
        <ToolBlockOutput>
          {content.error && (
            <ToolCallErrorView
              error={{ type: "unknown", message: content.error }}
            />
          )}
          {output}
        </ToolBlockOutput>
      )}
    </ToolBlock>
  );
};

const formattedServerResult = (
  id: string | undefined,
  content: ContentToolUse
): ReactNode => {
  if (content.error) return null;
  const webSearchResult = maybeWebSearchResult(content);
  if (webSearchResult) {
    return <WebSearchResults id={id} results={webSearchResult.result} />;
  }
  const listToolsResult = maybeListTools(content);
  if (listToolsResult) {
    return <ListToolsResult id={id} tools={listToolsResult.result} />;
  }
  const codeExecutionResult = maybeCodeExecution(content);
  if (codeExecutionResult) {
    const hasOutput =
      codeExecutionResult.stdout ||
      codeExecutionResult.stderr ||
      codeExecutionResult.encrypted ||
      (codeExecutionResult.returnCode ?? 0) !== 0;
    return hasOutput ? (
      <CodeExecutionResult id={id} result={codeExecutionResult} />
    ) : null;
  }
  return hasResultContent(content.result) ? (
    <ExpandablePanel
      id={`${id}-output`}
      collapse={true}
      border={false}
      lines={15}
    >
      <RenderedContent
        id={`${id}-output`}
        entry={{ name: "Output", value: content.result }}
        renderOptions={{ renderString: "markdown" }}
      />
    </ExpandablePanel>
  ) : null;
};

const WebSearchResults: FC<{ id?: string; results: WebResult[] }> = ({
  id,
  results,
}) => {
  return (
    <ExpandablePanel
      id={`${id}-output`}
      collapse={true}
      border={false}
      lines={15}
    >
      {results.map((result, index) => (
        <div key={index}>
          <ExternalLink href={result.url} title={result.url}>
            {result.title}
          </ExternalLink>
        </div>
      ))}
    </ExpandablePanel>
  );
};

const ListToolsResult: FC<{ id?: string; tools: ToolInfo[] }> = ({
  id,
  tools,
}) => {
  return (
    <ExpandablePanel
      id={`${id}-output`}
      collapse={true}
      border={false}
      lines={15}
    >
      {tools.map((tool, index) => (
        <div key={tool.name} className={styles.tool}>
          <code className="text-size-smaller">{tool.name}</code>
          <div className="text-size-smaller">{tool.description}</div>
          <RecordTree
            id={`${id}-tool-${index}`}
            record={{ schema: tool.input_schema }}
            defaultExpandLevel={0}
          />
        </div>
      ))}
    </ExpandablePanel>
  );
};

const CodeExecutionResult: FC<{
  id?: string;
  result: CodeExecutionOutput;
}> = ({ id, result }) => {
  return (
    <ExpandablePanel
      id={`${id}-output`}
      collapse={true}
      border={false}
      lines={15}
    >
      {result.stdout ? (
        <pre className={styles.execOutput}>
          <ContentText text={result.stdout} />
        </pre>
      ) : null}
      {result.stderr ? (
        <pre className={clsx(styles.execOutput, styles.execError)}>
          <ContentText text={result.stderr} />
        </pre>
      ) : null}
      {!result.stdout && !result.stderr && result.encrypted ? (
        <div className={clsx("text-style-secondary", "text-size-smaller")}>
          Output encrypted by the model provider.
        </div>
      ) : null}
      {typeof result.returnCode === "number" && result.returnCode !== 0 ? (
        <div className={clsx("text-style-secondary", "text-size-smaller")}>
          exit code {result.returnCode}
        </div>
      ) : null}
    </ExpandablePanel>
  );
};

interface CodeExecutionOutput {
  stdout?: string;
  stderr?: string;
  returnCode?: number;
  encrypted: boolean;
}

/** Parses a code_execution result payload into stdout/stderr/exit code.
 * Returns undefined when the result isn't the expected JSON shape (the
 * generic markdown rendering applies instead). */
const maybeCodeExecution = (
  content: ContentToolUse
): CodeExecutionOutput | undefined => {
  if (content.tool_type !== "code_execution" || !isJson(content.result)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(content.result);
    if (!isRecord(parsed)) {
      return undefined;
    }
    // The execution payload nests under `content` (Anthropic's
    // code_execution_tool_result shape); fall back to the top level.
    const payload = isRecord(parsed.content) ? parsed.content : parsed;
    const str = (value: unknown): string | undefined =>
      typeof value === "string" && value.length > 0 ? value : undefined;
    return {
      stdout: str(payload.stdout),
      stderr: str(payload.stderr),
      returnCode:
        typeof payload.return_code === "number"
          ? payload.return_code
          : undefined,
      encrypted: typeof payload.encrypted_stdout === "string",
    };
  } catch {
    return undefined;
  }
};

const resolveArgs = (content: ContentToolUse): Record<string, unknown> => {
  // See if this looks like a JSON object
  if (isJson(content.arguments)) {
    try {
      const parsed: unknown = JSON.parse(content.arguments);
      if (isRecord(parsed)) return parsed;
    } catch (e) {
      console.warn("Failed to parse arguments as JSON", e);
    }
  }
  return content.arguments ? { arguments: content.arguments } : {};
};

/** Single-line header summary: the lone arg's value (the query for
 * web_search, the URL for web_fetch), or `key: value` pairs otherwise. */
const argsSummary = (args: Record<string, unknown>): string => {
  const entries = Object.entries(args);
  const single = entries.length === 1 ? entries[0] : undefined;
  if (single && typeof single[1] === "string") {
    return single[1];
  }
  return entries
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`
    )
    .join(", ");
};

const hasResultContent = (result: ContentToolUse["result"]): boolean =>
  result.trim().length > 0;

const maybeWebSearchResult = (
  content: ContentToolUse
): { result: WebResult[] } | undefined => {
  if (content.name !== "web_search") {
    return undefined;
  }
  const objArray = asJsonObjArray(content.result);
  // No recognizable entries (e.g. error results): fall through to the raw
  // rendering rather than presenting an empty results panel.
  const results = objArray?.filter(isWebResult);
  if (results !== undefined && results.length > 0) {
    return { result: results };
  }
};

const maybeListTools = (
  content: ContentToolUse
): { result: ToolInfo[] } | undefined => {
  if (content.name !== "mcp_list_tools") {
    return undefined;
  }
  const objArray = asJsonObjArray(content.result);
  // Same as web search: an all-filtered-out result reads as unrecognized.
  const results = objArray?.filter(isToolInfo);
  if (results !== undefined && results.length > 0) {
    return { result: results };
  }
};

interface WebResult {
  title: string;
  url: string;
  type: string;
}

/** Shallow: the list below renders title and url, and skips entries lacking them. */
const isWebResult = (value: unknown): value is WebResult =>
  isRecord(value) &&
  typeof value["title"] === "string" &&
  typeof value["url"] === "string";

interface ToolInfo {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Shallow: the list below keys on name and renders description. */
const isToolInfo = (value: unknown): value is ToolInfo =>
  isRecord(value) && typeof value["name"] === "string";
