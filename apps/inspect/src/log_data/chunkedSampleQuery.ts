import { skipToken } from "@tanstack/react-query";

import { EvalSample } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { getApi } from "../app_config";
import { SampleHandle } from "../app/types";

import {
  classifySampleShape,
  openChunkedSample,
  type ChunkedSample,
} from "./chunked";
import { hydrateFullSample, shouldFullyHydrate } from "./chunkedHydrate";
import { kSampleGcTimeMs } from "./sampleQuery";

/**
 * A chunked-shape sample and the EvalSample synthesized from it.
 * `null` (as the query datum) means the sample is a monolith — the caller
 * proceeds down the existing completed-sample path.
 */
export interface ChunkedSampleData {
  /**
   * Present when the sample renders through the chunked windowed path.
   * Absent when the sample was fully hydrated instead (it needs
   * producer-timeline fidelity and is under the size gate — see
   * `shouldFullyHydrate`): the legacy UI then renders `evalSample` alone,
   * exactly as it would a monolith sample.
   */
  chunked?: ChunkedSample;
  /**
   * The sample as an EvalSample. Windowed path: the shell only (sequences
   * empty — the transcript never reads `events` on this object). Hydrated
   * path: the fully downloaded, fully resolved sample.
   */
  evalSample: EvalSample;
}

const chunkedSampleQueryKey = (
  logDir: string,
  handle: SampleHandle | undefined
) =>
  [
    "log_data",
    "chunked-sample",
    logDir,
    handle?.logFile ?? null,
    handle?.id ?? null,
    handle?.epoch ?? null,
  ] as const;

const shellEvalSample = async (chunked: ChunkedSample): Promise<EvalSample> => {
  // `sequences` is the pre-central-directory chunk layout — logs converted
  // before it was dropped still carry it; strip it so it never leaks into
  // the synthesized EvalSample
  const {
    message_refs: _messageRefs,
    sequences: _sequences,
    ...shell
  } = chunked.shell;
  // The shell is the EvalSample serialization minus the four sequences and
  // metadata (design/large-samples.md, "Chunked on-disk layout") — the same
  // parse-boundary lift as remoteLogFile's `readJSONFile(...) as EvalSample`.
  return {
    ...shell,
    messages: [],
    events: [],
    attachments: {},
    metadata: (await chunked.readMetadata?.()) ?? {},
  } as unknown as EvalSample;
};

/**
 * Chunked-shape classification + open for a sample, keyed
 * `["log_data", "chunked-sample", ...]`. Settles `null` for monolith
 * samples (classification is a central-directory lookup on the already-open
 * log — no extra fetch); the completed-sample fetch is gated on that
 * settlement so exactly one path acquires the sample.
 *
 * Classification failures also settle `null`: the pre-existing monolith
 * path must stay the sole error surface for old-format samples (its
 * retry/fallback handling is authoritative), so this query only reports
 * errors for samples it has positively classified as chunked — which the
 * monolith path could never serve anyway.
 */
export const useChunkedSample = (
  logDir: string,
  handle: SampleHandle | undefined
): AsyncData<ChunkedSampleData | null> =>
  useAsyncDataFromQuery({
    queryKey: chunkedSampleQueryKey(logDir, handle),
    queryFn: handle
      ? async (): Promise<ChunkedSampleData | null> => {
          let zip;
          try {
            zip = await getApi().get_log_zip_access?.(handle.logFile);
          } catch {
            return null;
          }
          if (
            !zip ||
            classifySampleShape(zip.entryNames, handle.id, handle.epoch) !==
              "chunked"
          ) {
            return null;
          }
          const chunked = await openChunkedSample(
            zip,
            zip.entryNames,
            handle.id,
            handle.epoch
          );
          if (shouldFullyHydrate(chunked, zip)) {
            return { evalSample: await hydrateFullSample(chunked) };
          }
          return { chunked, evalSample: await shellEvalSample(chunked) };
        }
      : skipToken,
    gcTime: kSampleGcTimeMs,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // ChunkedSample holds live reader objects (caches, in-flight maps) —
    // never structurally clone/merge them.
    structuralSharing: false,
  });
