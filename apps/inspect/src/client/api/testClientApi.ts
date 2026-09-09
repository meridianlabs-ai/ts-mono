/**
 * Cast-free fixtures for the client/api types: a ClientAPI whose members
 * throw unless overridden, and complete minimal values of the log data
 * shapes, spread-merged with per-test overrides.
 */
import { testEvalSpec } from "@tsmono/inspect-common/testing";

import type { ClientAPI, LogDetails, LogHeader, SampleSummary } from "./types";

export const notImplemented = (name: string) => (): never => {
  throw new Error(`${name} not implemented in test`);
};

/**
 * A complete ClientAPI whose required methods throw unless overridden.
 * Optional methods stay undefined so presence-probing code paths behave as
 * they would against a backend that lacks them.
 */
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

export const testSampleSummary = (
  overrides: Partial<SampleSummary> = {}
): SampleSummary => ({
  id: "s1",
  epoch: 1,
  input: "input",
  target: "",
  scores: null,
  metadata: {},
  completed: true,
  model_usage: {},
  role_usage: {},
  ...overrides,
});

export const testLogDetails = (
  overrides: Partial<LogDetails> = {}
): LogDetails => ({
  version: 2,
  status: "success",
  eval: testEvalSpec(),
  sampleSummaries: [],
  ...overrides,
});

/** The stored form of a details payload (LogHeader), with sample facts zeroed. */
export const testLogHeader = (
  overrides: Partial<LogHeader> = {}
): LogHeader => ({
  eval: testEvalSpec(),
  sampleCount: 0,
  sampleErrorCount: 0,
  sampleLimits: [],
  ...overrides,
});
