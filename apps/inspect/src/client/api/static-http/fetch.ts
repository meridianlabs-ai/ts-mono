import { asyncJsonParse, encodePathParts } from "@tsmono/util";

import { normalizeEvalLog } from "../../utils/normalize";
import { LogContents, LogFilesFetchResponse, LogPreview } from "../types";

/**
 * Fetches a file from the specified URL as a string
 */
export async function fetchTextFile(
  url: string,
  handleError?: (response: Response) => boolean
): Promise<string | undefined> {
  const safe_url = encodePathParts(url);
  const response = await fetch(`${safe_url}`, { method: "GET" });
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
  url: string,
  parse: (text: string) => Promise<T>,
  handleError?: (response: Response) => boolean
): Promise<T | undefined> {
  const safe_url = encodePathParts(url);
  const response = await fetch(`${safe_url}`, { method: "GET" });
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
  file: string
): Promise<LogContents | undefined> => {
  return fetchFile<LogContents>(file, async (text): Promise<LogContents> => {
    // normalizeEvalLog owns format-version migrations (v1 scorer→scores)
    // and read-time defaults.
    const log = await asyncJsonParse<unknown>(text);
    return {
      raw: text,
      parsed: normalizeEvalLog(log),
    };
  });
};

/**
 * Fetches a log file and parses its content, updating the log structure if necessary.
 */
export const fetchManifest = async (
  log_dir: string
): Promise<LogFilesFetchResponse | undefined> => {
  const parseListing = async (text: string): Promise<LogFilesFetchResponse> => {
    const parsed = await asyncJsonParse<Record<string, LogPreview>>(text);
    return { raw: text, parsed };
  };
  return await fetchFile<LogFilesFetchResponse>(
    log_dir + "/listing.json",
    parseListing
  );
};

/**
 * Fetches a file, parsing its content and returning the result.
 */
export const fetchJsonFile = async <T>(
  file: string,
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

/**
 * Joins multiple URI segments into a single URI string.
 *
 * This function removes any leading or trailing slashes from each segment
 * and then joins them with a single slash (`/`).
 */
export function joinURI(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/(^\/+|\/+$)/g, "")) // Remove leading/trailing slashes from each segment
    .join("/");
}
