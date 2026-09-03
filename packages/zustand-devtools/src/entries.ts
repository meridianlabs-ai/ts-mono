export interface Entry {
  /** Unique among siblings — safe to use as a React key. */
  id: string;
  /** Display name; distinct Map keys may stringify identically. */
  key: string;
  value: unknown;
}

export type ValueKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "function"
  | "collection"
  | "other";

export const isExpandable = (value: unknown): boolean =>
  typeof value === "object" && value !== null;

const objectEntries = (o: object): Entry[] =>
  Object.entries(o).map(([key, value]: [string, unknown]) => ({
    id: key,
    key,
    value,
  }));

// Distinct Map keys can stringify identically (1 vs "1", any two objects), so
// ids carry the key's type plus a per-collision counter. The counter (rather
// than the entry index) keeps ids stable across unrelated insertions, which
// preserves expanded state in the tree.
const mapEntries = (m: Map<unknown, unknown>): Entry[] => {
  const seen = new Map<string, number>();
  return [...m.entries()].map(([k, v]: [unknown, unknown]) => {
    const key = typeof k === "string" ? k : String(k);
    const base = `${typeof k}:${key}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { id: n === 0 ? base : `${base}:${n}`, key, value: v };
  });
};

export const entriesOf = (value: unknown): Entry[] => {
  if (value instanceof Map) {
    return mapEntries(value);
  }
  if (value instanceof Set) {
    return [...value].map((v: unknown, i) => ({
      id: String(i),
      key: String(i),
      value: v,
    }));
  }
  if (Array.isArray(value)) {
    return value.map((v: unknown, i) => ({
      id: String(i),
      key: String(i),
      value: v,
    }));
  }
  if (typeof value === "object" && value !== null) {
    return objectEntries(value);
  }
  return [];
};

export const kindOf = (value: unknown): ValueKind => {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
    case "bigint":
      return "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "object":
      return "collection";
    default:
      return "other";
  }
};

export const previewOf = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") {
    return `ƒ ${value.name || "anonymous"}()`;
  }
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value instanceof Date) return value.toISOString();
  return `{…} ${Object.keys(value).length} keys`;
};

export const toClipboardJson = (value: unknown): string => {
  const replace = (v: unknown): unknown => {
    if (v instanceof Map) {
      return Object.fromEntries(
        [...v.entries()].map(([k, val]: [unknown, unknown]) => [
          typeof k === "string" ? k : String(k),
          val,
        ])
      );
    }
    if (v instanceof Set) return [...v];
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "function") return `ƒ ${v.name || "anonymous"}()`;
    return v;
  };
  try {
    return (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      JSON.stringify(value, (_key, v: unknown) => replace(v), 2) ?? "undefined"
    );
  } catch (error) {
    return `<unserializable: ${error instanceof Error ? error.message : String(error)}>`;
  }
};
