import clsx from "clsx";
import { FC } from "react";

import type { ContentToolUse } from "@tsmono/inspect-common/types";
import { ContentText, ExpandablePanel } from "@tsmono/react/components";

import { ExternalLink } from "../../content/ExternalLink";
import { RecordTree } from "../../content/RecordTree";
import { RenderedContent } from "../../content/RenderedContent";
import { iconForTool } from "../tools/tool";
import { ToolBlock, ToolBlockInput, ToolBlockOutput } from "../tools/ToolBlock";
import { ToolCallErrorView } from "../tools/ToolCallErrorView";
import { ToolInput } from "../tools/ToolInput";

import styles from "./ServerToolCall.module.css";
import {
  serverToolView,
  type CodeExecutionOutput,
  type ToolInfo,
  type WebResult,
} from "./serverToolView";

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
  const { title, summary, inputArgs, output } = serverToolView(content);

  return (
    <ToolBlock
      id={id}
      flush={flush}
      icon={iconForTool(content.name, { server: true })}
      title={title}
      summary={summary}
      pill="server"
      className={className}
    >
      {inputArgs.length > 0 ? (
        <ToolBlockInput>
          <ExpandablePanel
            id={`${id}-input`}
            collapse={true}
            border={false}
            lines={20}
            className={"text-size-small"}
          >
            {inputArgs.map(([key, value]) => (
              <ToolInput
                key={key}
                contentType={
                  content.tool_type === "code_execution" ? "python" : undefined
                }
                contents={value}
              />
            ))}
          </ExpandablePanel>
        </ToolBlockInput>
      ) : null}
      {output ? (
        <ToolBlockOutput>
          {output.kind === "error" ? (
            <ToolCallErrorView
              error={{ type: "unknown", message: output.message }}
            />
          ) : output.kind === "web_search" ? (
            <WebSearchResults id={id} results={output.results} />
          ) : output.kind === "list_tools" ? (
            <ListToolsResult id={id} tools={output.tools} />
          ) : output.kind === "code_execution" ? (
            <CodeExecutionResult id={id} result={output.result} />
          ) : (
            <ExpandablePanel
              id={`${id}-output`}
              collapse={true}
              border={false}
              lines={15}
            >
              <RenderedContent
                id={`${id}-output`}
                entry={{ name: "Output", value: output.text }}
                renderOptions={{ renderString: "markdown" }}
              />
            </ExpandablePanel>
          )}
        </ToolBlockOutput>
      ) : null}
    </ToolBlock>
  );
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
