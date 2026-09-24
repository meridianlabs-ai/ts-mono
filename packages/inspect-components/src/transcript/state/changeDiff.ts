import type { JsonChange } from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

/**
 * One rendered row of a state diff. Mirrors the delta shapes jsondiffpatch's
 * HTML formatter draws, so the diff keeps its existing look.
 */
export type DiffEntry =
  | { kind: "added"; value: unknown }
  | { kind: "deleted"; value: unknown }
  | { kind: "modified"; left: unknown; right: unknown }
  | { kind: "node"; isArray: boolean; children: DiffChild[] };

export interface DiffChild {
  /** Unique among siblings (a key can carry both its own value and a subtree). */
  id: string;
  key: string;
  entry: DiffEntry;
}

interface Slot {
  value: unknown;
}

// Children live in a Map so log-authored segments like `__proto__` are plain
// keys, never property writes.
interface ChangeNode {
  before?: Slot;
  after?: Slot;
  children: Map<string, ChangeNode>;
}

const newNode = (): ChangeNode => ({ children: new Map() });

/** RFC 6901 segments; empty segments are dropped as before. */
export const parsePointer = (path: string): string[] =>
  path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

const nodeAt = (root: ChangeNode, segments: string[]): ChangeNode => {
  let node = root;
  for (const segment of segments) {
    let child = node.children.get(segment);
    if (!child) {
      child = newNode();
      node.children.set(segment, child);
    }
    node = child;
  }
  return node;
};

/**
 * Indexes the changes by path, one before/after slot per path (last write
 * wins, as JSON-patch replay would leave it). Work and size are linear in the
 * change list; numeric segments are just keys, so no index is ever padded.
 * `copy` and `test` carry no displayable change and are skipped.
 */
const buildChangeTree = (changes: JsonChange[]): ChangeNode => {
  const root = newNode();
  for (const change of changes) {
    switch (change.op) {
      case "add":
        nodeAt(root, parsePointer(change.path)).after = { value: change.value };
        break;
      case "replace": {
        const node = nodeAt(root, parsePointer(change.path));
        node.before = { value: change.replaced };
        node.after = { value: change.value };
        break;
      }
      case "remove":
        nodeAt(root, parsePointer(change.path)).before = {
          value: change.value,
        };
        break;
      case "move":
        nodeAt(root, parsePointer(change.from ?? "")).before = {
          value: change.value,
        };
        nodeAt(root, parsePointer(change.path)).after = { value: change.value };
        break;
      case "copy":
      case "test":
        break;
    }
  }
  return root;
};

const isArrayIndex = (key: string): boolean => /^(0|[1-9]\d*)$/.test(key);

// Index-like keys first in numeric order, then the rest in insertion order —
// the order Object.keys gave the old synthesized objects. Compared by length
// then text so a huge index never goes through Number.
const orderChildren = (children: DiffChild[]): DiffChild[] => {
  const indexed = children.filter((c) => isArrayIndex(c.key));
  const named = children.filter((c) => !isArrayIndex(c.key));
  indexed.sort((a, b) =>
    a.key.length !== b.key.length
      ? a.key.length - b.key.length
      : a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0
  );
  return [...indexed, ...named];
};

const nodeEntry = (children: DiffChild[]): DiffEntry | undefined => {
  if (children.length === 0) return undefined;
  const ordered = orderChildren(children);
  return {
    kind: "node",
    isArray: ordered.every((c) => isArrayIndex(c.key)),
    children: ordered,
  };
};

/**
 * Structural diff of a replaced value against its replacement. Arrays compare
 * by position, not LCS, so the work is linear in the values' size.
 */
const diffValues = (
  left: unknown,
  right: unknown,
  id: string
): DiffEntry | undefined => {
  if (Array.isArray(left) && Array.isArray(right)) {
    const leftItems: unknown[] = left;
    const rightItems: unknown[] = right;
    const children: DiffChild[] = [];
    const length = Math.max(leftItems.length, rightItems.length);
    for (let i = 0; i < length; i++) {
      const key = String(i);
      const childId = `${id}/${key}`;
      const entry =
        i >= leftItems.length
          ? { kind: "added" as const, value: rightItems[i] }
          : i >= rightItems.length
            ? { kind: "deleted" as const, value: leftItems[i] }
            : diffValues(leftItems[i], rightItems[i], childId);
      if (entry) children.push({ id: childId, key, entry });
    }
    return nodeEntry(children);
  }
  if (isRecord(left) && isRecord(right)) {
    const children: DiffChild[] = [];
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const childId = `${id}/${key}`;
      const inLeft = Object.hasOwn(left, key);
      const inRight = Object.hasOwn(right, key);
      const entry =
        inLeft && inRight
          ? diffValues(left[key], right[key], childId)
          : inRight
            ? { kind: "added" as const, value: right[key] }
            : { kind: "deleted" as const, value: left[key] };
      if (entry) children.push({ id: childId, key, entry });
    }
    return nodeEntry(children);
  }
  return Object.is(left, right) ? undefined : { kind: "modified", left, right };
};

const ownEntry = (node: ChangeNode, id: string): DiffEntry | undefined => {
  if (node.before && node.after) {
    return diffValues(node.before.value, node.after.value, id);
  }
  if (node.after) return { kind: "added", value: node.after.value };
  if (node.before) return { kind: "deleted", value: node.before.value };
  return undefined;
};

const childEntries = (node: ChangeNode, id: string): DiffChild[] => {
  const children: DiffChild[] = [];
  for (const [key, child] of node.children) {
    const childId = `${id}/${key}`;
    const own = ownEntry(child, `${childId}#own`);
    if (own) children.push({ id: `${childId}#own`, key, entry: own });
    const nested = nodeEntry(childEntries(child, childId));
    if (nested) children.push({ id: childId, key, entry: nested });
  }
  return children;
};

/**
 * Builds the rendered diff straight from the change list: each op already
 * names what changed, so there's no before/after pair to reconstruct and
 * re-diff. The root is always an object, as the old synthesized sides were.
 */
export const diffFromChanges = (
  changes: JsonChange[]
): DiffEntry | undefined => {
  const children = childEntries(buildChangeTree(changes), "");
  if (children.length === 0) return undefined;
  return { kind: "node", isArray: false, children: orderChildren(children) };
};

const materializeAfter = (node: ChangeNode): unknown => {
  if (node.children.size === 0) return node.after?.value;
  const own = node.after?.value;
  const entries: [string, unknown][] =
    isRecord(own) || Array.isArray(own) ? Object.entries(own) : [];
  for (const [key, child] of node.children) {
    const value = materializeAfter(child);
    if (value !== undefined) entries.push([key, value]);
  }
  // fromEntries defines own properties, so a `__proto__` key stays a key.
  return Object.fromEntries(entries);
};

/**
 * The post-change value at `path` as far as the changes reveal it: the value
 * written there, overlaid with anything written beneath it (sub-path writes
 * come back as object keys, including array indexes). Undefined if no change
 * touches the path. Work is linear in the change list.
 */
export const resolveAfter = (changes: JsonChange[], path: string): unknown => {
  const prefix = parsePointer(path);
  const root = newNode();
  for (const change of changes) {
    if (change.op !== "add" && change.op !== "replace" && change.op !== "move")
      continue;
    const segments = parsePointer(change.path);
    if (
      segments.length < prefix.length ||
      prefix.some((segment, i) => segments[i] !== segment)
    ) {
      continue;
    }
    nodeAt(root, segments.slice(prefix.length)).after = {
      value: change.value,
    };
  }
  return materializeAfter(root);
};

/**
 * A list-valued state entry as [index, item] pairs, whether the changes wrote
 * it whole (an array) or item by item (index-keyed object).
 */
export const indexedItems = (value: unknown): [string, unknown][] => {
  if (Array.isArray(value)) {
    return value.map((item: unknown, index) => [String(index), item]);
  }
  if (isRecord(value)) {
    return Object.entries(value).filter(([key]) => isArrayIndex(key));
  }
  return [];
};
