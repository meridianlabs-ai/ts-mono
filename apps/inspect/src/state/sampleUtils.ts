import { EvalSample } from "@tsmono/inspect-common/types";

import { SampleSummary } from "../client/api/types";

/**
 * Build a minimal EvalSample from a pending-buffer summary that has errored.
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
  return {
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
  } as unknown as EvalSample;
};
