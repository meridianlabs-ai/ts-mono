import { normalizeEvalSample } from "@tsmono/inspect-common/normalize";
import {
  ConfigUpdate,
  EvalLog,
  EvalPlan,
  EvalSample,
  EvalSpec,
} from "@tsmono/inspect-common/types";
import { asyncJsonParseBytes, AsyncQueue, fetchRange } from "@tsmono/util";

import { clearLargeEventsArray } from "../../utils/clear-events-preprocessor";
import {
  EvalHeader,
  LogDetails,
  LogPreview,
  LogViewAPI,
  ProgressCallback,
  SampleSummary,
} from "../api/types";
import {
  normalizeConfigUpdates,
  normalizeEvalHeader,
  normalizeLogStart,
} from "../utils/normalize";
import { toLogPreview } from "../utils/type-utils";

import {
  CentralDirectoryEntry,
  FileSizeLimitError,
  openRemoteZipFile,
} from "./remoteZipFile";

const OPEN_RETRY_LIMIT = 5;

// Maximum uncompressed sample size (512MB). Files larger than this will
// fail to allocate memory in the browser, so we reject them early with a
// clear error rather than crashing with "Array buffer allocation failed".
const MAX_SAMPLE_SIZE_BYTES = 2048 * 1024 * 1024;

interface SampleEntry {
  sampleId: string;
  epoch: number;
}

export class SampleNotFoundError extends Error {
  constructor(message?: string) {
    super(message || "Sample not found");
    this.name = "SampleNotFoundError";

    Object.setPrototypeOf(this, SampleNotFoundError.prototype);
  }
}
/**
 * Raw entry-level access to an open log zip: the central-directory name set
 * plus decompressed entry reads. Format-agnostic — consumers (e.g. the
 * chunked-sample data layer) bring their own entry-name conventions.
 */
export interface LogZipAccess {
  entryNames: ReadonlySet<string>;
  readFile: (name: string) => Promise<Uint8Array>;
  /** Uncompressed size of an entry (central directory; no fetch). */
  uncompressedSize: (name: string) => number | undefined;
}

export interface RemoteLogFile {
  readEvalBasicInfo: () => Promise<LogPreview>;
  readLogSummary: () => Promise<LogDetails>;
  readSample: (
    sampleId: string,
    epoch: number,
    onProgress?: ProgressCallback
  ) => Promise<EvalSample>;
  /** Entry-level access to the already-open zip (range reads, no server). */
  zipAccess: () => LogZipAccess;
  readCompleteLog: () => Promise<EvalLog>;
}

export interface LogStart {
  version: number;
  eval: EvalSpec;
  plan: EvalPlan;
}

/**
 * Synthesize an EvalHeader from a `_journal/start.json` payload.
 *
 * `header.json` is only written at end-of-eval, so while a log is in
 * progress the viewer falls back to `start.json` (which carries the
 * EvalSpec + EvalPlan). The Python side does the analogous lift via
 * `EvalLog.recompute_tags_and_metadata` on the model validator —
 * `log.tags` / `log.metadata` derive from `eval.tags` / `eval.metadata`
 * until `log_updates` adds edits on top. Mirror that here so a running
 * log's chips and metadata still render in the viewer.
 *
 * Exported for unit testing.
 */
export const headerFromLogStart = (start: LogStart): EvalHeader => ({
  status: "started",
  eval: start.eval,
  plan: start.plan,
  tags: start.eval.tags ?? [],
  metadata: start.eval.metadata ?? {},
});

const JOURNAL_SUMMARIES_DIR = "_journal/summaries/";

// parseInt stops at the ".json" suffix
const journalFileIndex = (filename: string): number =>
  parseInt(filename.slice(JOURNAL_SUMMARIES_DIR.length), 10);

/**
 * Keep the last row per (id, epoch), matching the Python readers'
 * last-entry-wins rule: a requeued sample's re-run is recorded after its
 * superseded prior attempt.
 *
 * Exported for unit testing.
 */
export const dedupeSummaries = (
  summaries: SampleSummary[]
): SampleSummary[] => {
  const byKey = new Map<string, SampleSummary>();
  for (const summary of summaries) {
    byKey.set(JSON.stringify([summary.id, summary.epoch]), summary);
  }
  return Array.from(byKey.values());
};

/**
 * Journaled config updates (`_journal/config_updates/{n}.json`) in write
 * order — the recorder names entries by a monotonic integer index, so
 * non-integer names are ignored rather than poisoning the sort with NaN.
 *
 * Exported for unit testing; `openRemoteLogFile` binds it to its zip.
 */
export const readJournalConfigUpdatesFrom = async (
  entryNames: Iterable<string>,
  readEntry: (name: string) => Promise<unknown>
): Promise<ConfigUpdate[]> => {
  const prefix = "_journal/config_updates/";
  const entries = Array.from(entryNames)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => ({ name, index: parseInt(name.slice(prefix.length), 10) }))
    .filter(({ index }) => Number.isFinite(index))
    .sort((a, b) => a.index - b.index);

  const updates: ConfigUpdate[] = [];
  for (const entry of entries) {
    try {
      // Malformed entries are dropped rather than poisoning the fold.
      updates.push(...normalizeConfigUpdates([await readEntry(entry.name)]));
    } catch (error) {
      // The fold is last-wins in order: splicing around a failed middle
      // read would silently misreport later state, while a truncated tail
      // cannot — stop at the first failure.
      console.error(`Failed to read config update ${entry.name}:`, error);
      break;
    }
  }
  return updates;
};

/**
 * Opens a remote log file and provides methods to read its contents.
 */
export const openRemoteLogFile = async (
  api: LogViewAPI,
  url: string,
  concurrency: number
): Promise<RemoteLogFile> => {
  const queue = new AsyncQueue(concurrency);

  const logInfo = await api.get_log_info(url);
  const directUrl = logInfo.direct_url;
  // ETag of the log file at open time. Surfaced through `readLogSummary`
  // so the `edit_log` middleware can seed an `If-Match` for the first
  // edit (subsequent edits use the etag returned by the previous save).
  const initialEtag = logInfo.etag ?? undefined;
  const fetchBytes = async (
    _url: string,
    start: number,
    end: number
  ): Promise<Uint8Array> => {
    if (directUrl) {
      try {
        return await fetchRange(directUrl, start, end);
      } catch (e) {
        console.warn("Direct URL fetch failed, falling back to proxy", e);
      }
    }
    return api.get_log_bytes(url, start, end);
  };

  let remoteZipFile:
    | {
        centralDirectory: Map<string, CentralDirectoryEntry>;
        readFile: (
          file: string,
          maxBytes?: number,
          onProgress?: ProgressCallback
        ) => Promise<Uint8Array>;
      }
    | undefined = undefined;

  let retryCount = 0;
  while (!remoteZipFile && retryCount < OPEN_RETRY_LIMIT) {
    try {
      remoteZipFile = await openRemoteZipFile(url, logInfo.size, fetchBytes);
    } catch {
      retryCount++;
      console.warn(
        `Failed to open remote log file at ${url}, retrying (${retryCount}/${OPEN_RETRY_LIMIT})...`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * (retryCount + retryCount))
      );
    }
  }

  if (!remoteZipFile) {
    throw new Error(
      `Failed to open remote log file at ${url} after ${OPEN_RETRY_LIMIT} attempts.`
    );
  }

  interface JSONPreprocessor {
    preprocess: (data: Uint8Array) => Uint8Array;
  }

  /**
   * Reads and parses a JSON file from the zip.
   * Optionally applies a preprocessor to transform bytes before decoding.
   */
  const readJSONFile = async (
    file: string,
    maxBytes?: number,
    preprocessor?: JSONPreprocessor,
    onProgress?: ProgressCallback
  ): Promise<object> => {
    try {
      let data = await remoteZipFile.readFile(file, maxBytes, onProgress);

      // Apply preprocessor if provided
      if (preprocessor) {
        data = preprocessor.preprocess(data);
      }

      // Send bytes directly to the worker pool, avoiding a redundant
      // TextDecoder.decode + TextEncoder.encode round-trip on the main thread.
      return asyncJsonParseBytes(data);
    } catch (error) {
      if (error instanceof FileSizeLimitError) {
        throw error;
      } else if (error instanceof Error) {
        throw new Error(
          `Failed to read or parse file ${file}: ${error.message}`,
          { cause: error }
        );
      } else {
        throw new Error(
          `Failed to read or parse file ${file} - an unknown error occurred`,
          { cause: error }
        );
      }
    }
  };

  /**
   * Lists all samples in the zip file.
   */
  const listSamples = (): Promise<SampleEntry[]> => {
    // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
    return Promise.resolve(
      Array.from(remoteZipFile.centralDirectory.keys())
        .filter(
          (filename) =>
            filename.startsWith("samples/") && filename.endsWith(".json")
        )
        .map((filename) => {
          // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
          const [sampleId, epochStr] = filename.split("/")[1].split("_epoch_");
          return {
            sampleId,
            // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
            epoch: parseInt(epochStr.split(".")[0], 10),
          };
        })
    );
  };

  /**
   * Reads a specific sample file.
   */
  const readSample = async (
    sampleId: string,
    epoch: number,
    onProgress?: ProgressCallback
  ): Promise<EvalSample> => {
    const sampleFile = `samples/${sampleId}_epoch_${epoch}.json`;

    if (!remoteZipFile.centralDirectory.has(sampleFile)) {
      throw new SampleNotFoundError(
        `Unable to read sample file ${sampleFile} - it is not present in the manifest.`
      );
    }

    // Check the uncompressed size before attempting to read – this avoids
    // crashing the browser with "Array buffer allocation failed".
    const entry = remoteZipFile.centralDirectory.get(sampleFile)!;
    if (entry.uncompressedSize > MAX_SAMPLE_SIZE_BYTES) {
      throw new FileSizeLimitError(sampleFile, MAX_SAMPLE_SIZE_BYTES);
    }

    // Use a preprocessor to clear large events arrays
    const eventsPreprocessor: JSONPreprocessor = {
      preprocess: clearLargeEventsArray,
    };
    return normalizeEvalSample(
      await readJSONFile(sampleFile, undefined, eventsPreprocessor, onProgress)
    );
  };

  /**
   * Reads the results.json file.
   */
  const readHeader = async (): Promise<EvalHeader> => {
    if (remoteZipFile.centralDirectory.has("header.json")) {
      return normalizeEvalHeader(await readJSONFile("header.json"));
    } else {
      // While the eval is still running, header.json hasn't been
      // written yet — the recorder only flushes it at end-of-eval.
      // Fall back to start.json and synthesize a header from it.
      const start = normalizeLogStart(
        await readJSONFile("_journal/start.json")
      );
      const header = headerFromLogStart(start);
      // Mid-run retunes are journaled immediately (one file per update,
      // consolidated into header.json only at end-of-eval) — fold them in
      // so running and crashed logs surface config_updates too.
      const config_updates = await readJournalConfigUpdates();
      return config_updates.length > 0 ? { ...header, config_updates } : header;
    }
  };

  const readJournalConfigUpdates = (): Promise<ConfigUpdate[]> =>
    readJournalConfigUpdatesFrom(
      remoteZipFile.centralDirectory.keys(),
      (name) => readJSONFile(name)
    );

  const readEvalBasicInfo = async (): Promise<LogPreview> => {
    const header = await readHeader();
    return toLogPreview(header);
  };

  /**
   * Reads individual summary files when summaries.json is not available.
   */
  const readFallbackSummaries = async (): Promise<SampleSummary[]> => {
    // sorted numerically so the merge below is deterministic: reads complete
    // out of order, and dedupe needs the later journal file's rows to win
    const summaryFiles = Array.from(remoteZipFile.centralDirectory.keys())
      .filter(
        (filename) =>
          filename.startsWith(JOURNAL_SUMMARIES_DIR) &&
          filename.endsWith(".json")
      )
      .sort((a, b) => journalFileIndex(a) - journalFileIndex(b));

    const perFile: SampleSummary[][] = [];
    const errors: unknown[] = [];

    await Promise.all(
      summaryFiles.map((filename, index) =>
        queue.enqueue(async () => {
          try {
            const parsed = await readJSONFile(filename);
            if (!Array.isArray(parsed)) {
              throw new Error(`Expected an array in ${filename}`);
            }
            perFile[index] = parsed as SampleSummary[];
          } catch (error) {
            errors.push(error);
          }
        })
      )
    );

    if (errors.length > 0) {
      console.error(
        `Encountered ${errors.length} errors while reading summary files:`,
        errors
      );
    }

    // flat() skips the holes failed reads leave behind
    return dedupeSummaries(perFile.flat());
  };

  /**
   * Reads all summaries, falling back to individual files if necessary.
   */
  const readSampleSummaries = async (): Promise<SampleSummary[]> => {
    if (remoteZipFile.centralDirectory.has("summaries.json")) {
      // deduped defensively, like the Python reader: a log finalized before
      // the recorder superseded re-logged samples in its flush buffer can
      // carry both a requeued sample's rows
      return dedupeSummaries(
        (await readJSONFile("summaries.json")) as SampleSummary[]
      );
    } else {
      return readFallbackSummaries();
    }
  };

  return {
    readEvalBasicInfo,
    readLogSummary: async () => {
      const [header, sampleSummaries] = await Promise.all([
        readHeader(),
        readSampleSummaries(),
      ]);
      const result = {
        status: header.status,
        eval: header.eval,
        plan: header.plan,
        results: header.results,
        stats: header.stats,
        error: header.error,
        tags: header.tags,
        metadata: header.metadata,
        log_updates: header.log_updates,
        config_updates: header.config_updates,
        sampleSummaries,
        etag: initialEtag,
      };
      return result;
    },
    readSample,
    zipAccess: () => ({
      entryNames: new Set(remoteZipFile.centralDirectory.keys()),
      readFile: (name: string) => remoteZipFile.readFile(name),
      uncompressedSize: (name: string) =>
        remoteZipFile.centralDirectory.get(name)?.uncompressedSize,
    }),
    /**
     * Reads the complete log file.
     */
    readCompleteLog: async (): Promise<EvalLog> => {
      const [evalLogHeader, samples] = await Promise.all([
        readHeader(),
        listSamples().then((sampleIds) =>
          Promise.all(
            sampleIds.map(({ sampleId, epoch }) => readSample(sampleId, epoch))
          )
        ),
      ]);

      return {
        version: evalLogHeader.version ?? 2,
        status: evalLogHeader.status ?? "started",
        invalidated: evalLogHeader.invalidated ?? false,
        eval: evalLogHeader.eval,
        plan: evalLogHeader.plan,
        results: evalLogHeader.results,
        stats: evalLogHeader.stats,
        error: evalLogHeader.error,
        tags: evalLogHeader.tags ?? [],
        metadata: evalLogHeader.metadata ?? {},
        samples,
        // Boundary lift (#555): stats/plan are only written at end-of-eval,
        // so an in-progress log genuinely lacks them despite EvalLog
        // requiring them — EvalHeader models that with optional fields.
      } as EvalLog;
    },
  };
};
