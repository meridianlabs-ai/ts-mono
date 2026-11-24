import { isRecord, maybeBase64 } from "@tsmono/util";

const kMaxStringValueDisplay = 1048576;

/** The text `JSONPanel` shows for `data`: pretty-printed, with images,
 *  base64 and very long strings replaced by placeholders. */
export const jsonPanelText = (data: unknown): string =>
  JSON.stringify(resolveBase64(data), undefined, 2);

const resolveBase64 = (value: unknown): unknown => {
  const prefix = "data:image";

  // Handle arrays recursively
  if (Array.isArray(value)) {
    return value.map((v) => resolveBase64(v));
  }

  // Handle objects recursively
  if (isRecord(value)) {
    const resolvedObject: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      resolvedObject[key] = resolveBase64(value[key]);
    }
    return resolvedObject;
  }

  // Handle string values with protocol references
  if (typeof value === "string") {
    let resolvedValue = value;
    if (resolvedValue.startsWith(prefix)) {
      resolvedValue = "[base64 image]";
    } else if (resolvedValue.length > kMaxStringValueDisplay) {
      resolvedValue = "[long data]";
    } else if (maybeBase64(resolvedValue)) {
      resolvedValue = "[base64 data]";
    }
    return resolvedValue;
  }

  // Return unchanged for other types
  return value;
};
