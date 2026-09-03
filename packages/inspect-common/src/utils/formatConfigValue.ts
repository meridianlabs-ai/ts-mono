/** Scalar-ish config values render plain; structures fall back to JSON. */
export const formatConfigValue = (
  value: unknown,
  nullLabel = "none"
): string => {
  if (value === null || value === undefined) {
    return nullLabel;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }
  return JSON.stringify(value);
};
