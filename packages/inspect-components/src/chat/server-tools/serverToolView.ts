import type { ContentToolUse } from "@tsmono/inspect-common/types";
import {
  jsonPanelText,
  type ContentRenderingPolicy,
} from "@tsmono/react/components";
import {
  asJsonObjArray,
  isRecord,
  isRenderableImageSource,
  parseJsonRecord,
} from "@tsmono/util";

export interface WebResult {
  title: string;
  url: string;
  type: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CodeExecutionOutput {
  stdout?: string;
  stderr?: string;
  returnCode?: number;
  encrypted: boolean;
}

export type ServerToolOutput =
  | { kind: "error"; message: string }
  | { kind: "web_search"; results: WebResult[] }
  | { kind: "list_tools"; tools: ToolInfo[] }
  | { kind: "code_execution"; result: CodeExecutionOutput }
  | { kind: "text"; text: string };

/** What `ServerToolCall` renders for a server-side tool call, parsed once so
 *  the view and Find read the same fields. */
export interface ServerToolView {
  title: string;
  /** Short args, summarized on the header line. */
  summary: string;
  /** Multi-line string args (code bodies), shown in the input zone. */
  inputArgs: Array<[string, string]>;
  /** Undefined when the call has no output to show. */
  output: ServerToolOutput | undefined;
}

export const serverToolView = (content: ContentToolUse): ServerToolView => {
  const summaryArgs: Record<string, unknown> = {};
  const inputArgs: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(resolveArgs(content))) {
    if (typeof value === "string" && value.includes("\n")) {
      inputArgs.push([key, value]);
    } else {
      summaryArgs[key] = value;
    }
  }
  return {
    title: content.context
      ? `${content.context} — ${content.name}`
      : content.name,
    summary: argsSummary(summaryArgs),
    inputArgs,
    output: resolveOutput(content),
  };
};

/**
 * The text a server-side tool call shows, for Find: the title, the args as
 * displayed, and the parsed output fields, so JSON escapes and hidden fields
 * can't match. An errored call contributes only its error. Web results
 * contribute their titles, and their URLs when `policy` shows links as text
 * (otherwise the URL is a tooltip). A result with no specific view
 * contributes the text its panel shows.
 */
export const serverToolTexts = (
  content: ContentToolUse,
  policy: ContentRenderingPolicy
): string[] => {
  const view = serverToolView(content);
  const texts = [view.title, view.summary, ...view.inputArgs.map(([, v]) => v)];
  const output = view.output;
  switch (output?.kind) {
    case "error":
      texts.push(output.message);
      break;
    case "web_search":
      for (const { title, url } of output.results) {
        // ExternalLink's inert form appends the destination.
        texts.push(policy.links || title === url ? title : `${title} (${url})`);
      }
      break;
    case "list_tools":
      for (const tool of output.tools) {
        texts.push(tool.name);
        if (typeof tool.description === "string") texts.push(tool.description);
      }
      break;
    case "code_execution":
      if (output.result.stdout) texts.push(output.result.stdout);
      if (output.result.stderr) texts.push(output.result.stderr);
      break;
    case "text":
      texts.push(shownText(output.text));
      break;
    case undefined:
      break;
  }
  return texts.filter((text) => text.length > 0);
};

/** The text the output panel shows (see `RenderedContent`): a JSON object
 *  pretty-printed with escapes decoded, and nothing for an inline image. */
const shownText = (text: string): string => {
  const record = parseJsonRecord(text);
  if (record) return jsonPanelText(record);
  return isRenderableImageSource(text) ? "" : text;
};

const resolveOutput = (
  content: ContentToolUse
): ServerToolOutput | undefined => {
  if (content.error) {
    return { kind: "error", message: content.error };
  }
  const webResults = maybeWebSearchResults(content);
  if (webResults) {
    return { kind: "web_search", results: webResults };
  }
  const tools = maybeListTools(content);
  if (tools) {
    return { kind: "list_tools", tools };
  }
  const execution = maybeCodeExecution(content);
  if (execution) {
    const hasOutput =
      !!execution.stdout ||
      !!execution.stderr ||
      execution.encrypted ||
      (execution.returnCode ?? 0) !== 0;
    return hasOutput
      ? { kind: "code_execution", result: execution }
      : undefined;
  }
  return content.result.trim().length > 0
    ? { kind: "text", text: content.result }
    : undefined;
};

/** Parses a code_execution result payload into stdout/stderr/exit code.
 * Returns undefined when the result isn't the expected JSON shape (the
 * generic markdown rendering applies instead). */
const maybeCodeExecution = (
  content: ContentToolUse
): CodeExecutionOutput | undefined => {
  const parsed =
    content.tool_type === "code_execution"
      ? parseJsonRecord(content.result)
      : undefined;
  if (!parsed) {
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
      typeof payload.return_code === "number" ? payload.return_code : undefined,
    encrypted: typeof payload.encrypted_stdout === "string",
  };
};

const resolveArgs = (content: ContentToolUse): Record<string, unknown> =>
  parseJsonRecord(content.arguments) ??
  (content.arguments ? { arguments: content.arguments } : {});

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

/** Undefined when there are no recognizable entries (e.g. error results), so
 * the raw rendering applies rather than an empty results panel. */
const maybeWebSearchResults = (
  content: ContentToolUse
): WebResult[] | undefined => {
  if (content.name !== "web_search") {
    return undefined;
  }
  const results = asJsonObjArray(content.result)?.filter(isWebResult);
  return results && results.length > 0 ? results : undefined;
};

const maybeListTools = (content: ContentToolUse): ToolInfo[] | undefined => {
  if (content.name !== "mcp_list_tools") {
    return undefined;
  }
  // Same as web search: an all-filtered-out result reads as unrecognized.
  const results = asJsonObjArray(content.result)?.filter(isToolInfo);
  return results && results.length > 0 ? results : undefined;
};

/** Shallow: the list renders title and url, and skips entries lacking them. */
const isWebResult = (value: unknown): value is WebResult =>
  isRecord(value) &&
  typeof value["title"] === "string" &&
  typeof value["url"] === "string";

/** Shallow: the list keys on name and renders description. */
const isToolInfo = (value: unknown): value is ToolInfo =>
  isRecord(value) && typeof value["name"] === "string";
