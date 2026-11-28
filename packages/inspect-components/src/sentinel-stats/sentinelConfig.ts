import { isRecord } from "@tsmono/util";

/** One configured monitor or protocol, as the Stack draws it. */
export interface ConfigRow {
  /** The instance name; "(top)" for the root. */
  name: string;
  /** The factory's registry name. */
  factory: string;
  /** Box-drawing prefix, as the step card's check tree draws it. */
  guides: string;
}

export interface ConfiguredSentinel {
  /** The root's instance name, which keys the sentinel's stats. */
  name: string;
  /** The root factory's version, where the config recorded one. */
  version?: number;
  rows: ConfigRow[];
}

const kEntryKeys: ReadonlySet<string> = new Set([
  "name",
  "params",
  "version",
  "meta",
]);

interface Entry {
  name: string;
  version?: number;
  nested: unknown[];
}

const asEntry = (value: unknown): Entry | undefined => {
  if (!isRecord(value) || typeof value.name !== "string") return undefined;
  return {
    name: value.name,
    version: typeof value.version === "number" ? value.version : undefined,
    nested: Object.entries(value)
      .filter(([key]) => !kEntryKeys.has(key))
      .map(([, layer]) => layer),
  };
};

/** The registry name without its package prefix, the instance name of an entry not keyed by a mapping. */
const shortName = (factory: string): string =>
  factory.split("/").at(-1) ?? factory;

/** A layer's instances: an entry, a list of entries, or a mapping of instance names to entries. */
const instancesOf = (layer: unknown): [string, Entry][] => {
  const entry = asEntry(layer);
  if (entry) return [[shortName(entry.name), entry]];
  const items: [string | undefined, unknown][] = Array.isArray(layer)
    ? layer.map((item: unknown) => [undefined, item])
    : isRecord(layer)
      ? Object.entries(layer)
      : [];
  return items.flatMap(([key, item]) => {
    const child = asEntry(item);
    return child ? [[key ?? shortName(child.name), child]] : [];
  });
};

const kConcurrent = "inspect_sentinel/concurrent";

/**
 * The configured tree of a sentinel, from `EvalConfig.sentinel`. A lone entry
 * is the root; a list or mapping is wrapped in `concurrent`, as
 * inspect_sentinel resolves it.
 */
export const configuredSentinel = (
  config: unknown
): ConfiguredSentinel | undefined => {
  const lone = asEntry(config);
  const root: Entry | undefined =
    lone ??
    (instancesOf(config).length > 0
      ? { name: kConcurrent, nested: [config] }
      : undefined);
  if (!root) return undefined;
  const rows: ConfigRow[] = [{ name: "(top)", factory: root.name, guides: "" }];
  const visit = (entry: Entry, prefix: string) => {
    const children = entry.nested.flatMap(instancesOf);
    children.forEach(([name, child], i) => {
      const last = i === children.length - 1;
      rows.push({
        name,
        factory: child.name,
        guides: `${prefix}${last ? "└─ " : "├─ "}`,
      });
      visit(child, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  visit(root, "");
  return { name: shortName(root.name), version: root.version, rows };
};
