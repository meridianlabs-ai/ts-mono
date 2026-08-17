/**
 * Cast-free ClientAPI fixture: every required member stubbed to throw,
 * spread-merged with per-test overrides.
 */
import type { ClientAPI } from "./types";

const notImplemented = (name: string) => (): never => {
  throw new Error(`${name} not implemented in test`);
};

export const testClientAPI = (
  overrides: Partial<ClientAPI> = {}
): ClientAPI => ({
  get_logs: notImplemented("get_logs"),
  get_eval_set: notImplemented("get_eval_set"),
  get_flow: notImplemented("get_flow"),
  get_log_summaries: notImplemented("get_log_summaries"),
  get_log_summaries_settled: notImplemented("get_log_summaries_settled"),
  get_log_details: notImplemented("get_log_details"),
  get_log_info: notImplemented("get_log_info"),
  get_log_sample: notImplemented("get_log_sample"),
  client_events: notImplemented("client_events"),
  download_file: notImplemented("download_file"),
  open_log_file: notImplemented("open_log_file"),
  get_app_config: notImplemented("get_app_config"),
  ...overrides,
});
