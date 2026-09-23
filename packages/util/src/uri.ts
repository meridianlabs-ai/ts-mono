/** First segment of a relative path ("" when empty). */
export const rootName = (relativePath: string): string =>
  relativePath.split("/")[0] ?? "";

const encodePathSegments = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const directoryRelativeUrl = (file: string, dir?: string): string => {
  if (!dir) {
    return encodePathSegments(file);
  }

  // Normalize paths to ensure consistent directory separators
  const normalizedFile = file.replace(/\\/g, "/");
  const normalizedLogDir = dir.replace(/\\/g, "/");

  // Ensure log_dir ends with a trailing slash
  const dirWithSlash = normalizedLogDir.endsWith("/")
    ? normalizedLogDir
    : normalizedLogDir + "/";

  // Check if file is within the log directory
  if (normalizedFile.startsWith(dirWithSlash)) {
    return encodePathSegments(normalizedFile.substring(dirWithSlash.length));
  }

  return encodePathSegments(normalizedFile);
};

export const join = (file: string, dir?: string): string => {
  if (!dir) {
    return file;
  }

  // Normalize paths to ensure consistent directory separators
  let normalizedFile = file.replace(/\\/g, "/");
  if (normalizedFile.startsWith("./")) {
    normalizedFile = normalizedFile.slice(2);
  }
  const normalizedLogDir = dir.replace(/\\/g, "/");

  // Ensure log_dir ends with a trailing slash
  const dirWithSlash = normalizedLogDir.endsWith("/")
    ? normalizedLogDir
    : normalizedLogDir + "/";

  if (
    normalizedFile + "/" === dirWithSlash ||
    normalizedFile.startsWith(dirWithSlash)
  ) {
    return normalizedFile;
  }

  return dirWithSlash + normalizedFile;
};

/**
 * `decodeURIComponent` that returns the input unchanged when it is not valid
 * percent-encoding (a name literally containing `100%done`), instead of
 * throwing URIError.
 */
export const tryDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

// Decoding first keeps already-encoded input idempotent; a raw "%" that
// fails to decode is part of the name and gets encoded as-is.
const encodePathSegmentsIdempotent = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(tryDecodeURIComponent(segment)))
    .join("/");

/**
 * Encodes the path segments of a URL or relative path to ensure special characters
 * (like `+`, spaces, etc.) are properly encoded without affecting legal characters like `/`.
 *
 * This function will encode file names and path portions of both absolute URLs and
 * relative paths. It ensures that components of a full URL, such as the protocol and
 * query parameters, remain intact, while only encoding the path.
 */
export function encodePathParts(url: string): string {
  if (!url) return url; // Handle empty strings

  let fullUrl: URL;
  try {
    fullUrl = new URL(url);
  } catch {
    // This is a relative path that isn't parseable as Uri
    return encodePathSegmentsIdempotent(url);
  }
  fullUrl.pathname = encodePathSegmentsIdempotent(fullUrl.pathname);
  return fullUrl.toString();
}

/**
 * Tests whether a string is a valid URI.
 *
 * @param value - The string to test
 * @returns true if the string is a valid URI, false otherwise
 */
export const isUri = (value: string): boolean => {
  if (!value) return false;

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

export const prettyDirUri = (uri: string) => {
  if (uri.startsWith("file://")) {
    return uri.replace("file://", "");
  } else {
    return uri;
  }
};
