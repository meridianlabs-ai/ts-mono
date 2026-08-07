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

// SVG is deliberately absent: it can carry script, so it is never rendered
// inline regardless of encoding.
export const rasterImageMimeTypes = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/x-icon",
]);

export const imageMimeAliases = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/vnd.microsoft.icon", "image/x-icon"],
]);

export const normalizedImageMimeType = (mimeType: string): string => {
  const normalized = mimeType.trim().toLowerCase();
  return imageMimeAliases.get(normalized) ?? normalized;
};

export const base64DataUriMimeType = (source: string): string | undefined => {
  const dataUri = parseDataUri(source);
  return dataUri?.base64 ? dataUri.mimeType : undefined;
};

/** Inline image data that is safe to render without a network request. */
export const isRenderableImageSource = (source: string): boolean => {
  const mimeType = base64DataUriMimeType(source);
  return (
    mimeType !== undefined &&
    rasterImageMimeTypes.has(normalizedImageMimeType(mimeType))
  );
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
