import { EvalSample } from "@tsmono/inspect-common/types";
import { expandEvents } from "@tsmono/inspect-common/utils";

import { ClientAPI } from "../client/api/types";
import { resolveAttachments } from "../utils/attachments";

/**
 * The backend has no body for the sample (e.g. a running sample whose buffer
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
 * Migrates and resolves attachments for a sample
 */
// Accepts raw sample JSON of any vintage (old logs nested events under
// `transcript`, and callers/tests pass partial shapes), normalizing it into
// an EvalSample. This is an inherently dynamic boundary, so the body operates
// on `any` rather than reconstructing the full union-typed sample shape.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
export const resolveSample = (sample: any): EvalSample => {
  sample = { ...sample };

  // Migrates old versions of samples to the new structure
  if (sample.transcript) {
    sample.events = sample.transcript.events;
    sample.attachments = sample.transcript.content;
  }

  // Resolve pool refs BEFORE attachments (pool messages may
  // contain attachment:// refs that need resolving in the next step)
  sample.events = expandEvents(sample.events, sample.events_data ?? null);
  sample.events_data = null;

  sample.attachments = sample.attachments || {};
  sample.input = resolveAttachments(sample.input, sample.attachments);
  sample.messages = resolveAttachments(sample.messages, sample.attachments);
  sample.events = resolveAttachments(sample.events, sample.attachments);
  // Retry-attempt events carry their own attachment:// refs into the shared
  // sample.attachments map; resolve them too before the map is cleared.
  if (sample.error_retries) {
    sample.error_retries = sample.error_retries.map(
      (retry: Record<string, unknown>) => ({
        ...retry,
        events: resolveAttachments(retry.events, sample.attachments),
      })
    );
  }
  sample.attachments = {};
  return sample;
};
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */

/**
 * Fetch a completed sample's body and normalize it (legacy-shape migration,
 * pool-ref expansion, attachment resolution). Throws `SampleNotFoundError`
 * when the backend has no body for the sample.
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
