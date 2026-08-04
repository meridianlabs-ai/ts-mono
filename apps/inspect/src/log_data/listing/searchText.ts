/**
 * The searchable-text primitives, defined once at the data layer so every
 * search surface — the record-level column schema, the grid's shaped-row
 * search index (`rowSearchText`), and Find's match scan — formats and joins
 * text identically. View code imports these; the data layer never imports
 * view code (the boundary rule, design/listing-data-interface.md).
 */

/** A raw value's searchable text. Objects/arrays are skipped rather than
 *  stringified ("[object Object]" must never be searchable text). */
export const primitiveText = (value: unknown): string | null => {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    default:
      return null;
  }
};

/** One row's searchable text from its per-column parts: empties dropped,
 *  newline-joined (a newline never matches a typed term, so a term can't
 *  match across adjacent columns' text), lowercased for case-insensitive
 *  matching. */
export const joinSearchText = (parts: ReadonlyArray<string | null>): string =>
  parts
    .filter((text): text is string => text !== null && text !== "")
    .join("\n")
    .toLowerCase();
