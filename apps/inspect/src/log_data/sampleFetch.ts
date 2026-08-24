import { normalizeEvalSample } from "@tsmono/inspect-common/normalize";
import { EvalSample } from "@tsmono/inspect-common/types";
import { expandEvents } from "@tsmono/inspect-common/utils";

import { ClientAPI, SampleSummary } from "../client/api/types";
import { resolveAttachments } from "../utils/attachments";

/**
 * The backend has no EvalSample for the sample (e.g. a running sample whose buffer
 * was flushed but whose log hasn't landed yet). A typed error rather than an
 * `undefined` return so react-query queryFns can call `fetchSample` directly;
 * callers that want the error-summary fallback catch this specifically.
 */
export class SampleNotFoundError extends Error {
  constructor(logFile: string, id: string | number, epoch: number) {
    super(`Sample ${id}/${epoch} not found in ${logFile}`);
    this.name = "SampleNotFoundError";
  }
}

/**
 * Accepts raw sample JSON of any vintage and produces a fully-resolved
 * EvalSample: boundary normalization (legacy-shape migration + read-time
 * defaults, see `normalizeEvalSample`), then pool-ref expansion and
 * `attachment://` resolution.
 */
export const resolveSample = (raw: unknown): EvalSample => {
  const sample = normalizeEvalSample(raw);

  // Resolve pool refs BEFORE attachments (pool messages may
  // contain attachment:// refs that need resolving in the next step)
  sample.events = expandEvents(sample.events, sample.events_data ?? null);
  sample.events_data = null;

  const attachments = sample.attachments;
  sample.input = resolveAttachments(sample.input, attachments);
  sample.messages = resolveAttachments(sample.messages, attachments);
  sample.events = resolveAttachments(sample.events, attachments);
  // Retry-attempt events carry their own attachment:// refs into the shared
  // sample.attachments map; resolve them too before the map is cleared.
  if (sample.error_retries) {
    sample.error_retries = sample.error_retries.map((retry) => ({
      ...retry,
      events: resolveAttachments(retry.events, attachments),
    }));
  }
  sample.attachments = {};
  return sample;
};

/**
 * Fetch a completed sample's EvalSample and normalize it (legacy-shape migration,
 * pool-ref expansion, attachment resolution). Throws `SampleNotFoundError`
 * when the backend has no EvalSample for the sample.
 */
export const fetchSample = async (
  api: ClientAPI,
  logFile: string,
  id: string | number,
  epoch: number
): Promise<EvalSample> => {
  const sample = await api.get_log_sample(logFile, id, epoch);
  if (!sample) {
    throw new SampleNotFoundError(logFile, id, epoch);
  }
  return resolveSample(sample);
};

/**
 * Build a minimal EvalSample from a pending-buffer summary that has errored —
 * the normalization the sample queries fall back to when the backend has no
 * EvalSample for the sample but its summary records an error.
 *
 * SampleSummary.error is a plain string but EvalSample.error is shaped
 * `{ message, traceback, traceback_ansi }`; we populate all three with the
 * same string since no real traceback is available.
 */
export const synthesizeErroredSampleFromSummary = (
  summary: SampleSummary
): EvalSample => {
  if (!summary.error) {
    throw new Error(
      "synthesizeErroredSampleFromSummary requires summary.error to be set"
    );
  }
  const errorMessage = summary.error;
  // normalizeEvalSample fills the remaining required fields (output
  // completion, role_usage, ...) the summary can't supply.
  return normalizeEvalSample({
    id: summary.id,
    epoch: summary.epoch,
    uuid: summary.uuid,
    input: summary.input,
    target: summary.target,
    scores: summary.scores ?? null,
    metadata: summary.metadata ?? {},
    model_usage: summary.model_usage ?? {},
    started_at: summary.started_at ?? null,
    completed_at: summary.completed_at ?? null,
    total_time: summary.total_time ?? null,
    working_time: summary.working_time ?? null,
    // SampleSummary.limit is a string but EvalSample.limit is an object,
    // so don't propagate it.
    limit: null,
    error: {
      message: errorMessage,
      traceback: errorMessage,
      traceback_ansi: errorMessage,
    },
    messages: [],
    events: [],
    attachments: {},
    output: {
      model: "",
      choices: [],
      usage: null,
    },
    store: {},
  });
};
