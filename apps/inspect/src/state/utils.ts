import { SampleSummary } from "../client/api/types";

// Function to merge log samples with pending samples
export const mergeSampleSummaries = (
  logSamples: SampleSummary[],
  pendingSamples: SampleSummary[]
) => {
  // Create a map of existing sample IDs to avoid duplicates
  const existingSampleIds = new Set(
    logSamples.map((sample) => `${sample.id}-${sample.epoch}`)
  );

  // Filter out any pending samples that already exist in the log
  const uniquePendingSamples = pendingSamples
    .filter((sample) => !existingSampleIds.has(`${sample.id}-${sample.epoch}`))
    .map((sample) => {
      // Terminal-with-error pending samples are rendered from the summary
      // by the manifest-miss fallback in useLoadSample / samplePolling.
      const isTerminalErrored = sample.completed === true && !!sample.error;
      if (isTerminalErrored) {
        return { ...sample };
      }

      // Pending-buffer samples are not necessarily in the .eval ZIP yet,
      // even if their work has completed. Keep them on the streaming path
      // until they appear in the log summaries.
      return { ...sample, completed: false };
    });

  // Combine and return all samples
  return [...logSamples, ...uniquePendingSamples];
};
