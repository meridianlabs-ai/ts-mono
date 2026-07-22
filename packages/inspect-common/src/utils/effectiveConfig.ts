import type {
  ConfigUpdate,
  EvalConfig,
  GenerateConfig,
  JsonValue,
  ProvenanceData,
} from "../types";

// Compile-time drift guards: regenerating types with added/removed config
// fields breaks these records, forcing the unknown-field skip to stay accurate.
const EVAL_CONFIG_KEYS: Record<keyof EvalConfig, true> = {
  acp_server: true,
  approval: true,
  continue_on_fail: true,
  cost_limit: true,
  epochs: true,
  epochs_reducer: true,
  fail_on_error: true,
  limit: true,
  log_buffer: true,
  log_images: true,
  log_model_api: true,
  log_realtime: true,
  log_samples: true,
  log_shared: true,
  max_dataset_memory: true,
  max_samples: true,
  max_sandboxes: true,
  max_subprocesses: true,
  max_tasks: true,
  message_limit: true,
  notification: true,
  retry_on_error: true,
  sample_id: true,
  sample_shuffle: true,
  sandbox_cleanup: true,
  score_display: true,
  score_on_error: true,
  time_limit: true,
  token_limit: true,
  token_limit_type: true,
  turn_limit: true,
  working_limit: true,
};

const GENERATE_CONFIG_KEYS: Record<keyof GenerateConfig, true> = {
  adaptive_connections: true,
  attempt_timeout: true,
  batch: true,
  best_of: true,
  cache: true,
  cache_prompt: true,
  effort: true,
  extra_body: true,
  extra_headers: true,
  fallback_models: true,
  frequency_penalty: true,
  internal_tools: true,
  logit_bias: true,
  logprobs: true,
  max_connections: true,
  max_retries: true,
  max_tokens: true,
  max_tool_output: true,
  modalities: true,
  num_choices: true,
  parallel_tool_calls: true,
  presence_penalty: true,
  prompt_logprobs: true,
  reasoning_effort: true,
  reasoning_history: true,
  reasoning_mode: true,
  reasoning_summary: true,
  reasoning_tokens: true,
  response_schema: true,
  seed: true,
  stop_seqs: true,
  system_message: true,
  temperature: true,
  timeout: true,
  top_k: true,
  top_logprobs: true,
  top_p: true,
  verbosity: true,
};

const foldConfig = <T extends object>(
  launch: T,
  updates: ConfigUpdate[] | null | undefined,
  family: "eval" | "generate",
  knownKeys: Record<string, true>
): T => {
  if (!updates || updates.length === 0) {
    return launch;
  }
  const launchRecord = launch as Record<string, unknown>;
  const result: Record<string, unknown> = { ...launchRecord };
  for (const update of updates) {
    for (const change of update.changes) {
      if (change.config !== family || !(change.name in knownKeys)) {
        continue;
      }
      if (change.cleared) {
        // Cleared restores the launch value — distinct from setting null.
        if (change.name in launchRecord) {
          result[change.name] = launchRecord[change.name];
        } else {
          delete result[change.name];
        }
      } else {
        result[change.name] = change.value;
      }
    }
  }
  return result as T;
};

/**
 * The eval config the run actually ran under: launch config with
 * `config_updates` folded in order. `cleared` restores the launch value;
 * `value: null` is a real setting; unknown fields and `"concurrency"`
 * changes are skipped. All eval-config reads should go through this.
 */
export const effectiveEvalConfig = (
  launch: EvalConfig,
  updates?: ConfigUpdate[] | null
): EvalConfig => foldConfig(launch, updates, "eval", EVAL_CONFIG_KEYS);

/**
 * The generate config the run actually ran under — same fold semantics as
 * `effectiveEvalConfig` over `config: "generate"` changes.
 */
export const effectiveGenerateConfig = (
  launch: GenerateConfig,
  updates?: ConfigUpdate[] | null
): GenerateConfig =>
  foldConfig(launch, updates, "generate", GENERATE_CONFIG_KEYS);

/** Final (last-wins) state of one knob touched by config updates. */
export interface ConfigChangeInfo {
  name: string;
  config: "eval" | "generate" | "concurrency";
  /** Value set by the last change (launch value when cleared). */
  value: JsonValue;
  /** Best-effort prior value recorded on the last change. */
  previous: JsonValue;
  /** Override removed — knob reverted to its launch value. */
  cleared: boolean;
  /** Explicitly set to null (e.g. a limit lifted) — not the same as cleared. */
  limitLifted: boolean;
  scope: "task" | "process";
  /** Process-scoped change inherited from before this log started. */
  inherited: boolean;
  provenance: ProvenanceData;
}

const changesFor = (
  updates: ConfigUpdate[] | null | undefined,
  family: "eval" | "generate",
  knownKeys: Record<string, true>
): Map<string, ConfigChangeInfo> => {
  const changes = new Map<string, ConfigChangeInfo>();
  for (const update of updates ?? []) {
    for (const change of update.changes) {
      if (change.config !== family || !(change.name in knownKeys)) {
        continue;
      }
      changes.set(change.name, {
        name: change.name,
        config: change.config,
        value: change.value,
        previous: change.previous,
        cleared: change.cleared,
        limitLifted:
          !change.cleared &&
          change.value === null &&
          change.previous !== null &&
          change.previous !== undefined,
        scope: update.scope,
        inherited: update.provenance.metadata?.["inherited"] === true,
        provenance: update.provenance,
      });
    }
  }
  return changes;
};

/**
 * Per-knob final change state for eval-config knobs (the "changed" chip
 * data), keyed by field name. Unknown fields and concurrency changes are
 * excluded, matching the fold.
 */
export const evalConfigChanges = (
  updates?: ConfigUpdate[] | null
): Map<string, ConfigChangeInfo> =>
  changesFor(updates, "eval", EVAL_CONFIG_KEYS);

/**
 * Per-knob final change state for generate-config knobs, keyed by field name.
 */
export const generateConfigChanges = (
  updates?: ConfigUpdate[] | null
): Map<string, ConfigChangeInfo> =>
  changesFor(updates, "generate", GENERATE_CONFIG_KEYS);
