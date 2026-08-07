export interface DataUri {
  mimeType: string;
  base64: boolean;
}

export const parseDataUri = (value: string): DataUri | undefined => {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return undefined;
  }

  if (uri.protocol.toLowerCase() !== "data:") {
    return undefined;
  }

  const comma = uri.pathname.indexOf(",");
  if (comma < 0) {
    return undefined;
  }

  const [rawMimeType = "", ...parameters] = uri.pathname
    .slice(0, comma)
    .split(";");
  const mimeType = rawMimeType.trim().toLowerCase();
  if (!mimeType) {
    return undefined;
  }

  return {
    mimeType,
    base64: parameters.some(
      (parameter) => parameter.trim().toLowerCase() === "base64"
    ),
  };
};

// Private, and deliberately not exported: these back a sanitizer decision, so
// a consumer able to call .add() could re-enable inline SVG process-wide.
// SVG is absent because it can carry script, whatever the encoding.
const rasterImageMimeTypes: ReadonlySet<string> = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/x-icon",
]);

const imageMimeAliases: ReadonlyMap<string, string> = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/vnd.microsoft.icon", "image/x-icon"],
]);

export const normalizedImageMimeType = (mimeType: string): string => {
  const normalized = mimeType.trim().toLowerCase();
  return imageMimeAliases.get(normalized) ?? normalized;
};

export const isRasterImageMimeType = (mimeType: string): boolean =>
  rasterImageMimeTypes.has(normalizedImageMimeType(mimeType));

export const base64DataUriMimeType = (source: string): string | undefined => {
  const dataUri = parseDataUri(source);
  return dataUri?.base64 ? dataUri.mimeType : undefined;
};

/** Inline image data that is safe to render without a network request. */
export const isRenderableImageSource = (source: string): boolean => {
  const mimeType = base64DataUriMimeType(source);
  return mimeType !== undefined && isRasterImageMimeType(mimeType);
};

/**
 * Canonical form of a renderable inline image source, or undefined.
 *
 * Callers that gate on the source must render THIS value rather than their
 * input: validating one string and emitting another lets characters the URL
 * parser rejects (U+FEFF, U+202F) survive into the DOM, where the browser
 * reads the result as a relative path and fetches it.
 */
export const canonicalImageSource = (source: string): string | undefined => {
  const trimmed = source.trim();
  if (!isRenderableImageSource(trimmed)) {
    return undefined;
  }
  try {
    return new URL(trimmed).href;
  } catch {
    return undefined;
  }
};

export const parseAbsoluteHttpUrl = (value: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname
  ) {
    return undefined;
  }

  return url.href;
};
