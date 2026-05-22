import JSON5 from "json5";

import { LogUpdate } from "@tsmono/inspect-common/types";
import { getVscodeApi } from "@tsmono/util";

import { asyncJsonParse } from "../../../utils/json-worker";
import {
  Capabilities,
  EditLogResult,
  LogContents,
  LogViewAPI,
  PendingSampleResponse,
  PendingSamples,
  SampleData,
  SampleDataResponse,
  UserInfo,
} from "../types";
import { ApiError } from "../view-server/request";

import {
  kJsonRpcMethodNotFound,
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
  webViewJsonRpcClient,
} from "./jsonrpc";

const kNotFoundSignal = "NotFound";
const kNotModifiedSignal = "NotModified";

const vscodeClient = webViewJsonRpcClient(getVscodeApi());

async function client_events() {
  return [];
}

async function get_log_root() {
  const response = await vscodeClient(kMethodEvalLogs, []);
  if (response) {
    const parsed = JSON5.parse(response);
    if (Array.isArray(parsed)) {
      // This is an old response, which omits the log_dir
      return {
        log_dir: "",
        files: parsed,
      };
    } else {
      return parsed;
    }
  } else {
    return undefined;
  }
}

const get_log_dir = async () => {
  const response = await vscodeClient(kMethodEvalLogDir, []);
  if (response) {
    const parsed = JSON5.parse(response);
    return parsed.log_dir as string | undefined;
  }
  return undefined;
};

const get_logs = async (mtime: number, clientFileCount: number) => {
  const response = await vscodeClient(kMethodEvalLogFiles, [
    mtime,
    clientFileCount,
  ]);
  if (response) {
    const parsed = JSON5.parse(response);
    return parsed;
  } else {
    return [];
  }
};

async function get_eval_set(): Promise<undefined> {
  return undefined;
}

async function get_flow(): Promise<undefined> {
  return undefined;
}

async function get_log_contents(
  log_file: string,
  headerOnly?: number,
  capabilities?: Capabilities
): Promise<LogContents> {
  const response = await vscodeClient(kMethodEvalLog, [log_file, headerOnly]);
  if (response) {
    let json;
    if (capabilities?.webWorkers) {
      json = await asyncJsonParse(response);
    } else {
      json = JSON5.parse(response);
    }
    return {
      parsed: json,
      raw: response,
    };
  } else {
    throw new Error(`Unable to load eval log ${log_file}.`);
  }
}

async function get_log_info(log_file: string) {
  try {
    return await vscodeClient(kMethodEvalLogInfo, [log_file]);
  } catch (e: any) {
    if (e?.code === kJsonRpcMethodNotFound) {
      // Extension predates eval_log_info — fall back to eval_log_size.
      const size = await vscodeClient("eval_log_size", [log_file]);
      return { size };
    }
    throw e;
  }
}

async function get_log_bytes(log_file: string, start: number, end: number) {
  return await vscodeClient(kMethodEvalLogBytes, [log_file, start, end]);
}

async function get_log_summaries(files: string[]) {
  const response = await vscodeClient(kMethodEvalLogHeaders, [files]);
  if (response) {
    return JSON5.parse(response);
  } else {
    return undefined;
  }
}

async function eval_pending_samples(
  log_file: string,
  etag?: string
): Promise<PendingSampleResponse> {
  // TODO: use web worked to parse when possible
  const response = await vscodeClient(kMethodPendingSamples, [log_file, etag]);
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
  const response = await vscodeClient(kMethodSampleData, [
    log_file,
    id,
    epoch,
    last_event,
    last_attachment,
    last_message_pool,
    last_call_pool,
  ]);
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

async function download_file() {
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
  } catch (e: any) {
    if (typeof e?.code === "number" && e.code >= 400 && e.code < 600) {
      throw new ApiError(e.code, e?.message ?? `Edit failed (${e.code})`);
    }
    if (e?.code === kJsonRpcMethodNotFound) {
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
        ? (JSON5.parse(response) as UserInfo)
        : (response as UserInfo);
    return info ?? {};
  } catch (e: any) {
    if (e?.code === kJsonRpcMethodNotFound) {
      return {};
    }
    throw e;
  }
}

async function open_log_file(log_file: string, log_dir: string) {
  const msg = {
    type: "displayLogFile",
    url: log_file,
    log_dir: log_dir,
  };
  getVscodeApi()?.postMessage(msg);
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
};

export default api;
