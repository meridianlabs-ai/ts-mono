import type { JsonChange } from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

/**
 * One rendered row of a state diff. Mirrors the delta shapes jsondiffpatch's
 * HTML formatter drew, so the diff keeps its existing look.
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

// `seq` orders writes so a later write or remove at a path supersedes earlier
// writes beneath it (as JSON-patch replay would) without walking the subtree.
interface Write {
  value: unknown;
  seq: number;
}

// Children live in a Map so log-authored segments like `__proto__` are plain
// keys, never property writes.
interface ChangeNode {
  before?: { value: unknown };
  after?: Write;
  /** Seq of the last op that replaced or removed this whole subtree. */
  reset?: number;
  children: Map<string, ChangeNode>;
}

const newNode = (): ChangeNode => ({ children: new Map() });

/** RFC 6901 segments; empty segments are dropped as before. */
export const parsePointer = (path: string): string[] =>
  path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

const nodeAt = (root: ChangeNode, path: string): ChangeNode => {
  let node = root;
  for (const segment of parsePointer(path)) {
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
 * Indexes the changes by path: one before/after slot per path, last write
 * wins. Work and size are linear in the change list; numeric segments are
 * just keys, so no index is ever padded. `copy` and `test` carry no
 * displayable change and are skipped.
 */
const buildChangeTree = (changes: JsonChange[]): ChangeNode => {
  const root = newNode();
  const write = (path: string, value: unknown, seq: number) => {
    const node = nodeAt(root, path);
    node.after = { value, seq };
    node.reset = seq;
  };
  const erase = (path: string, value: unknown, seq: number) => {
    const node = nodeAt(root, path);
    node.before = { value };
    node.after = undefined;
    node.reset = seq;
  };
  changes.forEach((change, seq) => {
    switch (change.op) {
      case "add":
        write(change.path, change.value, seq);
        break;
      case "replace":
        nodeAt(root, change.path).before = { value: change.replaced };
        write(change.path, change.value, seq);
        break;
      case "remove":
        erase(change.path, change.value, seq);
        break;
      case "move":
        erase(change.from ?? "", change.value, seq);
        write(change.path, change.value, seq);
        break;
      case "copy":
      case "test":
        break;
    }
  });
  return root;
};

/** The node's own post-change write, unless an ancestor op superseded it. */
const liveAfter = (node: ChangeNode, floor: number): Write | undefined =>
  node.after && node.after.seq > floor ? node.after : undefined;

const childFloor = (node: ChangeNode, floor: number): number =>
  Math.max(floor, node.reset ?? -1);

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
const diffValues = (left: unknown, right: unknown): DiffEntry | undefined => {
  if (Array.isArray(left) && Array.isArray(right)) {
    const leftItems: unknown[] = left;
    const rightItems: unknown[] = right;
    const children: DiffChild[] = [];
    const length = Math.max(leftItems.length, rightItems.length);
    for (let i = 0; i < length; i++) {
      const key = String(i);
      const entry =
        i >= leftItems.length
          ? { kind: "added" as const, value: rightItems[i] }
          : i >= rightItems.length
            ? { kind: "deleted" as const, value: leftItems[i] }
            : diffValues(leftItems[i], rightItems[i]);
      if (entry) children.push({ id: key, key, entry });
    }
    return nodeEntry(children);
  }
  if (isRecord(left) && isRecord(right)) {
    const children: DiffChild[] = [];
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const inLeft = Object.hasOwn(left, key);
      const inRight = Object.hasOwn(right, key);
      const entry =
        inLeft && inRight
          ? diffValues(left[key], right[key])
          : inRight
            ? { kind: "added" as const, value: right[key] }
            : { kind: "deleted" as const, value: left[key] };
      if (entry) children.push({ id: key, key, entry });
    }
    return nodeEntry(children);
  }
  return Object.is(left, right) ? undefined : { kind: "modified", left, right };
};

const ownEntry = (node: ChangeNode, floor: number): DiffEntry | undefined => {
  const after = liveAfter(node, floor);
  if (node.before && after) return diffValues(node.before.value, after.value);
  if (after) return { kind: "added", value: after.value };
  if (node.before) return { kind: "deleted", value: node.before.value };
  return undefined;
};

// Ids are `=key` for a key's own value row and `/key` for its subtree row:
// sibling keys are unique, so the prefix keeps the two rows apart.
const childEntries = (node: ChangeNode, floor: number): DiffChild[] => {
  const children: DiffChild[] = [];
  for (const [key, child] of node.children) {
    const own = ownEntry(child, floor);
    if (own) children.push({ id: `=${key}`, key, entry: own });
    const nested = nodeEntry(childEntries(child, childFloor(child, floor)));
    if (nested) children.push({ id: `/${key}`, key, entry: nested });
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
  const children = childEntries(buildChangeTree(changes), -1);
  if (children.length === 0) return undefined;
  return { kind: "node", isArray: false, children: orderChildren(children) };
};

// "removed" marks a key the changes deleted, so an overlay drops it from a
// value written whole above it.
type Resolved = { value: unknown } | "removed" | undefined;

const materializeAfter = (node: ChangeNode, floor: number): Resolved => {
  const after = liveAfter(node, floor);
  const nested = childFloor(node, floor);
  const overlay: [string, unknown][] = [];
  const dropped = new Set<string>();
  for (const [key, child] of node.children) {
    const resolved = materializeAfter(child, nested);
    if (resolved === "removed") dropped.add(key);
    else if (resolved) overlay.push([key, resolved.value]);
  }
  if (!after && overlay.length === 0) {
    return (node.reset ?? -1) > floor ? "removed" : undefined;
  }
  if (overlay.length === 0 && dropped.size === 0) return after;
  const own = after?.value;
  const base: [string, unknown][] =
    isRecord(own) || Array.isArray(own) ? Object.entries(own) : [];
  // fromEntries defines own properties, so a `__proto__` key stays a key.
  return {
    value: Object.fromEntries(
      [...base, ...overlay].filter(([key]) => !dropped.has(key))
    ),
  };
};

const ownChild = (value: unknown, key: string): unknown => {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return Object.hasOwn(items, key) ? items[Number(key)] : undefined;
  }
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
};

/**
 * The post-change value at `path` as far as the changes reveal it: writes at,
 * above or beneath the path replayed in order, with sub-path writes overlaid
 * as object keys (array indexes included). Undefined if no change reveals it.
 * Work is linear in the change list.
 */
export const resolveAfter = (changes: JsonChange[], path: string): unknown => {
  const resolved = materializeAfter(buildChangeTree(changes), -1);
  let value = resolved === "removed" ? undefined : resolved?.value;
  for (const segment of parsePointer(path)) {
    value = ownChild(value, segment);
  }
  return value;
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
