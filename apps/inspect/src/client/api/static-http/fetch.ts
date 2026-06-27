import { EvalLog } from "@tsmono/inspect-common/types";

import { asyncJsonParse } from "../../../utils/json-worker";
import { encodePathParts } from "../../../utils/uri";
import { grantedLogUrlHref, type GrantedLogUrl } from "../log-location";
import { LogContents, LogFilesFetchResponse, LogPreview } from "../types";

export const staticLogRequestInit: RequestInit = Object.freeze({
  credentials: "same-origin",
  referrerPolicy: "no-referrer",
  redirect: "error",
});

/**
 * Fetches a file from the specified URL as a string
 */
export async function fetchTextFile(
  url: GrantedLogUrl,
  handleError?: (response: Response) => boolean
): Promise<string | undefined> {
  const safe_url = encodePathParts(grantedLogUrlHref(url));
  const response = await fetch(`${safe_url}`, {
    ...staticLogRequestInit,
    method: "GET",
  });
  if (response.ok) {
    const text = await response.text();
    return text;
  } else if (response.status !== 200) {
    if (handleError && handleError(response)) {
      return undefined;
    }
    const message = (await response.text()) || response.statusText;
    const error = new Error(`${response.status}: ${message})`);
    throw error;
  } else {
    throw new Error(`${response.status} - ${response.statusText} `);
  }
}

/**
 * Fetches a file from the specified URL and parses its content.
 */
export async function fetchFile<T>(
  url: GrantedLogUrl,
  parse: (text: string) => Promise<T>,
  handleError?: (response: Response) => boolean
): Promise<T | undefined> {
  const safe_url = encodePathParts(grantedLogUrlHref(url));
  const response = await fetch(`${safe_url}`, {
    ...staticLogRequestInit,
    method: "GET",
  });
  if (response.ok) {
    const text = await response.text();
    return await parse(text);
  } else if (response.status !== 200) {
    if (handleError && handleError(response)) {
      return undefined;
    }
    const message = (await response.text()) || response.statusText;
    const error = new Error(`${response.status}: ${message})`);
    throw error;
  } else {
    throw new Error(`${response.status} - ${response.statusText} `);
  }
}

/**
 * Fetches a log file and parses its content, updating the log structure if necessary.
 */
export const fetchLogFile = async (
  file: GrantedLogUrl
): Promise<LogContents | undefined> => {
  return fetchFile<LogContents>(file, async (text): Promise<LogContents> => {
    const log = await asyncJsonParse<EvalLog>(text);
    if (log.version === 1) {
      if (log.results) {
        // v1 logs stored a single `results.scorer` object instead of a
        // `scores` array, and samples carried a single `score` field; both
        // reshapes touch fields that don't exist on the current EvalLog type,
        // so this migration block works against `any`.
        /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
        const untypedLog = log as any;
        log.results.scores = [];
        untypedLog.results.scorer.scorer = untypedLog.results.scorer.name;
        log.results.scores.push(untypedLog.results.scorer);
        delete untypedLog.results.scorer;
        // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
        log.results.scores[0].metrics = untypedLog.results.metrics;
        delete untypedLog.results.metrics;

        // migrate samples
        // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
        const scorerName = log.results.scores[0].name;
        log.samples?.forEach((sample) => {
          const untypedSample = sample as any;
          sample.scores = { [scorerName]: untypedSample.score };
          delete untypedSample.score;
        });
        /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
      }
    }
    return {
      raw: text,
      parsed: log,
    };
  });
};

/**
 * Fetches a log file and parses its content, updating the log structure if necessary.
 */
export const fetchManifest = async (
  listingFile: GrantedLogUrl
): Promise<LogFilesFetchResponse | undefined> => {
  const parseListing = async (text: string): Promise<LogFilesFetchResponse> => {
    const parsed = await asyncJsonParse<Record<string, LogPreview>>(text);
    return { raw: text, parsed };
  };
  return await fetchFile<LogFilesFetchResponse>(listingFile, parseListing);
};

/**
 * Fetches a file, parsing its content and returning the result.
 */
export const fetchJsonFile = async <T>(
  file: GrantedLogUrl,
  handleError?: (response: Response) => boolean
): Promise<T | undefined> => {
  return fetchFile<T>(
    file,
    async (text) => {
      return await asyncJsonParse<T>(text);
    },
    handleError
  );
};
