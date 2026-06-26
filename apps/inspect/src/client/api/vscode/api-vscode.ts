import JSON5 from "json5";

import {
  AppConfig,
  EvalLog,
  LogFilesResponse,
  LogInfo,
  LogUpdate,
} from "@tsmono/inspect-common/types";
import {
  getVscodeApi,
  JsonRpcClient,
  kJsonRpcMethodNotFound,
  webViewJsonRpcClient,
} from "@tsmono/util";

import { asyncJsonParse } from "../../../utils/json-worker";
import {
  Capabilities,
  EditLogResult,
  LogContents,
  LogPreview,
  LogRoot,
  LogViewAPI,
  PendingSampleResponse,
  PendingSamples,
  SampleData,
  SampleDataResponse,
  UserInfo,
} from "../types";
import { ApiError } from "../view-server/request";

import {
  kMethodAppConfig,
  kMethodEditLog,
  kMethodEvalLog,
  kMethodEvalLogBytes,
  kMethodEvalLogDir,
  kMethodEvalLogFiles,
  kMethodEvalLogHeaders,
  kMethodEvalLogInfo,
  kMethodEvalLogs,
  kMethodGetUserInfo,
  kMethodLogMessage,
  kMethodPendingSamples,
  kMethodSampleData,
} from "./jsonrpc";

const kNotFoundSignal = "NotFound";
const kNotModifiedSignal = "NotModified";

// JSON-RPC errors arrive as unknown in catch clauses; surface the fields
// the callers branch on without assuming a concrete error class.
const asRpcError = (e: unknown): { code?: number; message?: string } =>
  typeof e === "object" && e !== null ? e : {};

// This module is imported eagerly even outside VS Code, but the client is only
// ever exercised from the VS Code branch of resolveApi(). Build it lazily so
// the transport receives a definite VSCodeApi rather than threading
// `| undefined` through every signature.
let _vscodeClient: JsonRpcClient | undefined;
const vscodeClient: JsonRpcClient = (method, params) => {
  if (!_vscodeClient) {
    const vscode = getVscodeApi();
    if (!vscode) {
      throw new Error("VS Code API is not available in this environment.");
    }
    _vscodeClient = webViewJsonRpcClient(vscode);
  }
  return _vscodeClient(method, params);
};

function client_events(): Promise<string[]> {
  return Promise.resolve([]);
}

async function get_log_root() {
  const response = (await vscodeClient(kMethodEvalLogs, [])) as
    | string
    | undefined;
  if (response) {
    const parsed: unknown = JSON5.parse(response);
    if (Array.isArray(parsed)) {
      // This is an old response, which omits the log_dir
      return {
        log_dir: "",
        files: parsed,
      } as unknown as LogRoot;
    } else {
      return parsed as LogRoot;
    }
  } else {
    return undefined;
  }
}

const get_log_dir = async () => {
  const response = (await vscodeClient(kMethodEvalLogDir, [])) as
    | string
    | undefined;
  if (response) {
    const parsed = JSON5.parse<{ log_dir?: string }>(response);
    return parsed.log_dir;
  }
  return undefined;
};

const get_logs = async (
  mtime: number,
  clientFileCount: number
): Promise<LogFilesResponse> => {
  const response = (await vscodeClient(kMethodEvalLogFiles, [
    mtime,
    clientFileCount,
  ])) as string | undefined;
  if (response) {
    return JSON5.parse<LogFilesResponse>(response);
  } else {
    // No payload from the extension: an empty incremental response (no
    // changed files) matches LogFilesResponse. The prior `[]` predated the
    // typed contract and left `response.files` undefined for callers.
    return { files: [], response_type: "incremental" };
  }
};

function get_eval_set(): Promise<undefined> {
  return Promise.resolve(undefined);
}

function get_flow(): Promise<undefined> {
  return Promise.resolve(undefined);
}

async function get_log_contents(
  log_file: string,
  headerOnly?: number,
  capabilities?: Capabilities
): Promise<LogContents> {
  const response = (await vscodeClient(kMethodEvalLog, [
    log_file,
    headerOnly,
  ])) as string | undefined;
  if (response) {
    let json: EvalLog;
    if (capabilities?.webWorkers) {
      json = await asyncJsonParse<EvalLog>(response);
    } else {
      json = JSON5.parse<EvalLog>(response);
    }
    return {
      parsed: json,
      raw: response,
    };
  } else {
    throw new Error(`Unable to load eval log ${log_file}.`);
  }
}

async function get_log_info(log_file: string): Promise<LogInfo> {
  try {
    return (await vscodeClient(kMethodEvalLogInfo, [log_file])) as LogInfo;
  } catch (e: unknown) {
    if (asRpcError(e).code === kJsonRpcMethodNotFound) {
      // Extension predates eval_log_info — fall back to eval_log_size.
      const size = (await vscodeClient("eval_log_size", [log_file])) as number;
      return { size };
    }
    throw e;
  }
}

async function get_log_bytes(
  log_file: string,
  start: number,
  end: number
): Promise<Uint8Array> {
  return (await vscodeClient(kMethodEvalLogBytes, [
    log_file,
    start,
    end,
  ])) as Uint8Array;
}

async function get_log_summaries(files: string[]) {
  const response = (await vscodeClient(kMethodEvalLogHeaders, [files])) as
    | string
    | undefined;
  if (response) {
    return JSON5.parse<LogPreview[]>(response);
  } else {
    // Contract is LogPreview[]; the prior `undefined` predated the typed
    // contract. An empty array is the natural "no summaries" value.
    return [];
  }
}

async function eval_pending_samples(
  log_file: string,
  etag?: string
): Promise<PendingSampleResponse> {
  // TODO: use web worked to parse when possible
  const response = (await vscodeClient(kMethodPendingSamples, [
    log_file,
    etag,
  ])) as string | undefined;
  if (response) {
    if (response === kNotModifiedSignal) {
      return {
        status: "NotModified",
      };
    } else if (response === kNotFoundSignal) {
      return {
        status: "NotFound",
      };
    }

    const json = await asyncJsonParse<PendingSamples>(response);
    return {
      status: "OK",
      pendingSamples: json,
    };
  } else {
    throw new Error(`Unable to load pending samples ${log_file}.`);
  }
}

async function eval_log_sample_data(
  log_file: string,
  id: string | number,
  epoch: number,
  last_event?: number,
  last_attachment?: number,
  last_message_pool?: number,
  last_call_pool?: number
): Promise<SampleDataResponse | undefined> {
  const response = (await vscodeClient(kMethodSampleData, [
    log_file,
    id,
    epoch,
    last_event,
    last_attachment,
    last_message_pool,
    last_call_pool,
  ])) as string | undefined;
  if (response) {
    if (response === kNotModifiedSignal) {
      return {
        status: "NotModified",
      };
    } else if (response === kNotFoundSignal) {
      return {
        status: "NotFound",
      };
    }
    const json = await asyncJsonParse<SampleData>(response);
    return {
      status: "OK",
      sampleData: json,
    };
  } else {
    throw new Error(`Unable to load live sample data ${log_file}.`);
  }
}

async function log_message(log_file: string, message: string): Promise<void> {
  await vscodeClient(kMethodLogMessage, [log_file, message]);
}

function download_file(): Promise<void> {
  throw Error("Downloading files is not supported in VS Code");
}

/**
 * POSTs a LogUpdate (tag/metadata edits + provenance) to the VS Code
 * extension, which read-modifies-writes the log header and returns the
 * updated EvalLog (plus an ETag for S3-backed logs).
 *
 * Cross-process error mapping:
 *   - HTTP-style status codes (400/409/412/…) thrown by the extension
 *     come back through JSON-RPC with `error.code = <status>`. We
 *     re-throw them as `ApiError` so the existing dialog error mapper
 *     (`formatEditError`) handles 412 stale-ETag and 400 validation
 *     branches identically across the view-server and vscode paths.
 *   - `kJsonRpcMethodNotFound` means the extension predates edit
 *     support; surface an actionable message instead of the raw
 *     JSON-RPC text.
 */
async function edit_log(
  log_file: string,
  update: LogUpdate,
  if_match_etag?: string
): Promise<EditLogResult> {
  try {
    const response = await vscodeClient(kMethodEditLog, [
      log_file,
      update,
      if_match_etag,
    ]);
    if (!response) {
      throw new Error(`Edit returned no response for ${log_file}.`);
    }
    // Existing RPC methods are inconsistent about whether their
    // payload is wire-encoded (string) or returned as a parsed object
    // (e.g. `get_log_info`). Accept both so the handler isn't coupled
    // to which form the extension chooses.
    return (
      typeof response === "string" ? JSON5.parse(response) : response
    ) as EditLogResult;
  } catch (e: unknown) {
    const err = asRpcError(e);
    if (typeof err.code === "number" && err.code >= 400 && err.code < 600) {
      throw new ApiError(err.code, err.message ?? `Edit failed (${err.code})`);
    }
    if (err.code === kJsonRpcMethodNotFound) {
      throw new Error(
        "Log editing requires a newer Inspect VS Code extension."
      );
    }
    throw e;
  }
}

/**
 * Best-effort identity of the user editing logs, used to prefill the
 * Author field. Returns an empty object when the extension doesn't
 * expose the method (older extension); the dialog then leaves Author
 * blank and the user types it manually.
 */
async function get_user_info(): Promise<UserInfo> {
  try {
    const response = await vscodeClient(kMethodGetUserInfo, []);
    if (!response) return {};
    // Accept both wire shapes (string-encoded or parsed-object).
    // See the matching note on `edit_log` above.
    const info =
      typeof response === "string"
        ? JSON5.parse<UserInfo>(response)
        : (response as UserInfo);
    return info ?? {};
  } catch (e: unknown) {
    if (asRpcError(e).code === kJsonRpcMethodNotFound) {
      return {};
    }
    throw e;
  }
}

/**
 * Installed inspect / scout versions. Older extensions don't expose the
 * method (kJsonRpcMethodNotFound) — fall back to a placeholder so the
 * startup config gate still resolves and the app renders.
 */
async function get_app_config(): Promise<AppConfig> {
  try {
    const response = await vscodeClient(kMethodAppConfig, []);
    if (!response) return { inspect_version: "unknown", scout_version: null };
    return typeof response === "string"
      ? JSON5.parse<AppConfig>(response)
      : (response as AppConfig);
  } catch (e: unknown) {
    if (asRpcError(e).code === kJsonRpcMethodNotFound) {
      return { inspect_version: "unknown", scout_version: null };
    }
    throw e;
  }
}

function open_log_file(log_file: string, log_dir: string): Promise<void> {
  const msg = {
    type: "displayLogFile",
    url: log_file,
    log_dir: log_dir,
  };
  getVscodeApi()?.postMessage(msg);
  return Promise.resolve();
}

const api: LogViewAPI = {
  client_events,
  get_log_root,
  get_log_dir,
  get_logs,
  get_eval_set,
  get_flow,
  get_log_contents,
  get_log_info,
  get_log_bytes,
  get_log_summaries,
  log_message,
  download_file,
  open_log_file,
  eval_pending_samples,
  eval_log_sample_data,
  edit_log,
  get_user_info,
  get_app_config,
};

export default api;
