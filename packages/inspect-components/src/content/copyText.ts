/**
 * Plain-text form of a metadata value for clipboard copy.
 *
 * Strings copy verbatim; other scalars use their string form; objects
 * and arrays copy as pretty-printed JSON.
 */
export const copyValueText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "function"
  ) {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  // Circular structures (or exotic objects JSON can't represent) have no
  // sensible text form — copy an empty string rather than "[object Object]".
  // JSON.stringify's lib type omits the undefined case (e.g. a toJSON
  // returning undefined), hence the widened annotation.
  try {
    const json: unknown = JSON.stringify(value, null, 2);
    return typeof json === "string" ? json : "";
  } catch {
    return "";
  }
};
