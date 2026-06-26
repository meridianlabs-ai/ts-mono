import { VSCodeApi } from "@tsmono/util";

// Type definitions
interface JsonRpcMessage {
  jsonrpc: string;
  id: number;
}

interface JsonRpcRequest extends JsonRpcMessage {
  method: string;
  params?: unknown;
}

interface JsonRpcResponse extends JsonRpcMessage {
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: {
    description?: string;
    [key: string]: unknown;
  };
}

interface RequestHandlers {
  resolve: (value: unknown) => void;
  reject: (error: JsonRpcError) => void;
}

interface PostMessageTarget {
  postMessage: (data: unknown) => void;
  onMessage: (handler: (data: unknown) => void) => () => void;
}

// Constants
export const kMethodEvalLogDir = "eval_log_dir";
export const kMethodEvalLogs = "eval_logs";
export const kMethodEvalLogFiles = "eval_log_files";
export const kMethodEvalLog = "eval_log";
export const kMethodEvalLogInfo = "eval_log_info";
export const kMethodEvalLogBytes = "eval_log_bytes";
export const kMethodEvalLogHeaders = "eval_log_headers";
export const kMethodPendingSamples = "eval_log_pending_samples";
export const kMethodSampleData = "eval_log_sample_data";
export const kMethodLogMessage = "log_message";
// Log editing (Phase 1: tag + metadata edits) and best-effort author
// identity for prefilling the edit dialog's Author field. Both require
// a matching method on the VS Code extension side; older extensions
// will report `kJsonRpcMethodNotFound`, which the api-vscode caller
// translates into either an empty UserInfo (get_user_info) or a clear
// "newer extension required" message (edit_log).
export const kMethodEditLog = "edit_log";
export const kMethodGetUserInfo = "get_user_info";
export const kMethodAppConfig = "app_config";
export const kMethodHttpRequest = "http_request";

export const kJsonRpcParseError = -32700;
export const kJsonRpcInvalidRequest = -32600;
export const kJsonRpcMethodNotFound = -32601;
export const kJsonRpcInvalidParams = -32602;
export const kJsonRpcInternalError = -32603;
export const kJsonRpcVersion = "2.0";

export function webViewJsonRpcClient(
  vscode: VSCodeApi | undefined
): (method: string, params?: unknown) => Promise<unknown> {
  const target: PostMessageTarget = {
    postMessage: (data: unknown) => {
      vscode?.postMessage(data);
    },
    onMessage: (handler: (data: unknown) => void) => {
      const onMessage = (ev: MessageEvent) => {
        handler(ev.data);
      };
      window.addEventListener("message", onMessage);
      return () => {
        window.removeEventListener("message", onMessage);
      };
    },
  };
  return jsonRpcPostMessageRequestTransport(target).request;
}

export function jsonRpcError(
  message: string,
  data?: unknown,
  code?: number
): JsonRpcError {
  const errorData: JsonRpcError["data"] =
    typeof data === "string"
      ? { description: data }
      : (data as JsonRpcError["data"]);
  return {
    code: code || -3200,
    message,
    data: errorData,
  };
}

export function asJsonRpcError(error: unknown): JsonRpcError {
  if (typeof error === "object" && error !== null) {
    const err = error as { message?: string; data?: unknown; code?: number };
    if (typeof err.message === "string") {
      return jsonRpcError(err.message, err.data, err.code);
    }
  }
  return jsonRpcError(String(error));
}

export function jsonRpcPostMessageRequestTransport(target: PostMessageTarget) {
  const requests = new Map<number, RequestHandlers>();
  const disconnect = target.onMessage((ev: unknown) => {
    const response = asJsonRpcResponse(ev);
    if (response) {
      const request = requests.get(response.id);
      if (request) {
        requests.delete(response.id);
        if (response.error) {
          request.reject(response.error);
        } else {
          request.resolve(response.result);
        }
      }
    }
  });

  return {
    request: (method: string, params?: unknown): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const requestId = Math.floor(Math.random() * 1e6);
        requests.set(requestId, { resolve, reject });
        const request: JsonRpcRequest = {
          jsonrpc: kJsonRpcVersion,
          id: requestId,
          method,
          params,
        };
        target.postMessage(request);
      });
    },
    disconnect,
  };
}

export function jsonRpcPostMessageServer(
  target: PostMessageTarget,
  methods:
    | { [key: string]: (params: unknown) => Promise<unknown> }
    | ((name: string) => ((params: unknown) => Promise<unknown>) | undefined)
): () => void {
  const lookupMethod =
    typeof methods === "function" ? methods : (name: string) => methods[name];

  return target.onMessage((data: unknown) => {
    const request = asJsonRpcRequest(data);
    if (request) {
      const method = lookupMethod(request.method);
      if (!method) {
        target.postMessage(methodNotFoundResponse(request));
        return;
      }

      method(request.params || [])
        .then((value) => {
          target.postMessage(jsonRpcResponse(request, value));
        })
        .catch((error) => {
          target.postMessage({
            jsonrpc: request.jsonrpc,
            id: request.id,
            error: asJsonRpcError(error),
          });
        });
    }
  });
}

function isJsonRpcMessage(message: unknown): message is JsonRpcMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "jsonrpc" in message &&
    "id" in message
  );
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return (message as JsonRpcRequest).method !== undefined;
}

function asJsonRpcMessage(data: unknown): JsonRpcMessage | null {
  if (isJsonRpcMessage(data) && data.jsonrpc === kJsonRpcVersion) {
    return data;
  }
  return null;
}

function asJsonRpcRequest(data: unknown): JsonRpcRequest | null {
  const message = asJsonRpcMessage(data);
  if (message && isJsonRpcRequest(message)) {
    return message;
  }
  return null;
}

function asJsonRpcResponse(data: unknown): JsonRpcResponse | null {
  const message = asJsonRpcMessage(data);
  if (message) {
    return message;
  }
  return null;
}

function jsonRpcResponse(
  request: JsonRpcRequest,
  result: unknown
): JsonRpcResponse {
  return {
    jsonrpc: request.jsonrpc,
    id: request.id,
    result,
  };
}

function jsonRpcErrorResponse(
  request: JsonRpcRequest,
  code: number,
  message: string
): JsonRpcResponse {
  return {
    jsonrpc: request.jsonrpc,
    id: request.id,
    error: jsonRpcError(message, undefined, code),
  };
}

function methodNotFoundResponse(request: JsonRpcRequest): JsonRpcResponse {
  return jsonRpcErrorResponse(
    request,
    kJsonRpcMethodNotFound,
    `Method '${request.method}' not found.`
  );
}
