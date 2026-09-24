import clsx from "clsx";
import { FC, ReactNode, useEffect, useMemo } from "react";

import type {
  JsonChange,
  StateEvent,
  StoreEvent,
} from "@tsmono/inspect-common/types";
import { formatDateTime } from "@tsmono/util";

import { EventPanel } from "../event/EventPanel";
import { EventNode, EventPanelCallbacks } from "../types";

import { StateDiffView } from "./StateDiffView";
import {
  matchesChangeSignature,
  RenderableChangeTypes,
  StoreSpecificRenderableTypes,
} from "./StateEventRenderers";
import styles from "./StateEventView.module.css";

interface StateEventViewProps {
  eventNode: EventNode<StateEvent | StoreEvent>;
  isStore?: boolean;
  className?: string;
  onAutoCollapse?: (eventId: string) => void;
  eventCallbacks?: EventPanelCallbacks;
}

type JsonChangeOp = JsonChange["op"];
/**
 * Renders the StateEventView component.
 */
export const StateEventView: FC<StateEventViewProps> = ({
  eventNode,
  className,
  onAutoCollapse,
  eventCallbacks,
}) => {
  const event = eventNode.event;

  const summary = useMemo(() => {
    return summarizeChanges(event.changes);
  }, [event.changes]);

  // Synthesize objects for comparison
  const [before, after] = useMemo(() => {
    try {
      return synthesizeComparable(event.changes);
    } catch (e) {
      console.error(
        "Unable to synthesize comparable object to display state diffs.",
        e
      );
      return [{}, {}];
    }
  }, [event.changes]);

  // This clone is important since the state is used by react as potential values that are rendered
  // and as a result may be decorated with additional properties, etc..., resulting in DOM elements
  // appearing attached to state.
  const changePreview = useMemo(() => {
    const isStore = eventNode.event.event === "store";
    const afterClone = structuredClone(after);
    return generatePreview(event.changes, afterClone, isStore, eventNode.id);
  }, [event.changes, eventNode.event.event, after, eventNode.id]);
  // Compute the title
  const title = event.event === "state" ? "State Updated" : "Store Updated";

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (changePreview === undefined && onAutoCollapse) {
      onAutoCollapse(eventNode.id);
    }
  }, [changePreview, onAutoCollapse, eventNode.id]);

  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title={title}
      className={className}
      subTitle={
        event.timestamp ? formatDateTime(new Date(event.timestamp)) : undefined
      }
      text={!changePreview ? summary : undefined}
      collapsibleContent={true}
      eventCallbacks={eventCallbacks}
    >
      {changePreview ? (
        <div data-name="Summary" className={clsx(styles.summary)}>
          {changePreview}
        </div>
      ) : undefined}
      <StateDiffView
        before={before}
        after={after}
        data-name="Diff"
        className={clsx(styles.diff)}
      />
    </EventPanel>
  );
};

/**
 * Renders the value of a change based on its type.
 */
const generatePreview = (
  changes: JsonChange[],
  resolvedState: Record<string, unknown>,
  isStore: boolean,
  eventNodeId: string
) => {
  const results: ReactNode[] = [];
  for (const changeType of [
    ...RenderableChangeTypes,
    ...(isStore ? StoreSpecificRenderableTypes : []),
  ]) {
    if (changeType.signature) {
      if (matchesChangeSignature(changes, changeType.signature)) {
        const el = changeType.render(changes, resolvedState, eventNodeId);
        results.push(el);
        break;
      }
    } else if (changeType.match) {
      const matches = changeType.match(changes);
      if (matches) {
        const el = changeType.render(changes, resolvedState, eventNodeId);
        results.push(el);
        break;
      }
    }
  }
  return results.length > 0 ? results : undefined;
};

/**
 * Renders the value of a change based on its type.
 */
const summarizeChanges = (changes: JsonChange[]): string => {
  const changeMap: Record<JsonChangeOp, string[]> = {
    add: [],
    copy: [],
    move: [],
    replace: [],
    remove: [],
    test: [],
  };
  for (const change of changes) {
    switch (change.op) {
      case "add":
        changeMap.add.push(change.path);
        break;
      case "copy":
        changeMap.copy.push(change.path);
        break;
      case "move":
        changeMap.move.push(change.path);
        break;
      case "replace":
        changeMap.replace.push(change.path);
        break;
      case "remove":
        changeMap.remove.push(change.path);
        break;
      case "test":
        changeMap.test.push(change.path);
        break;
    }
  }

  const changeList: string[] = [];
  const totalOpCount = Object.values(changeMap).reduce(
    (prev, opChanges) => prev + opChanges.length,
    0
  );

  if (totalOpCount > 2) {
    Object.entries(changeMap).forEach(([key, opChanges]) => {
      if (opChanges.length > 0) {
        changeList.push(`${key} ${opChanges.length}`);
      }
    });
  } else {
    Object.entries(changeMap).forEach(([key, opChanges]) => {
      if (opChanges.length > 0) {
        changeList.push(`${key} ${opChanges.join(", ")}`);
      }
    });
  }
  return changeList.join(", ");
};

/**
 * JSON-pointer paths step through arrays as well as objects — a numeric
 * segment addresses an array index — so the synthesized-diff traversal
 * carries both shapes.
 */
type PathContainer = Record<string, unknown> | unknown[];

const isPathContainer = (value: unknown): value is PathContainer =>
  typeof value === "object" && value !== null;

// Path segments come from the log, so reads stay on the synthesized tree's
// own properties: a `/__proto__/x` path read through the prototype chain
// would step into Object.prototype and the write below would land there.
const getChild = (container: PathContainer, key: string): unknown => {
  if (Array.isArray(container)) {
    const index = Number(key);
    return Object.hasOwn(container, index) ? container[index] : undefined;
  }
  return Object.hasOwn(container, key) ? container[key] : undefined;
};

const setChild = (
  container: PathContainer,
  key: string,
  value: unknown
): void => {
  if (Array.isArray(container)) {
    container[Number(key)] = value;
  } else if (key === "__proto__") {
    // Assignment would hit the inherited setter and re-parent the container.
    // defineProperty stores an own key instead (jsondiffpatch skips the key
    // when diffing, so the change is dropped from the view, not rendered).
    Object.defineProperty(container, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    container[key] = value;
  }
};

// An array can't hold a non-numeric key — string props set on an array are
// invisible to JSON.stringify and the diff renderer's array walk — so when a
// path needs one (a dict with mixed numeric/non-numeric keys), re-key the
// array as a plain object.
const arrayToObject = (arr: unknown[]): Record<string, unknown> => {
  const obj: Record<string, unknown> = {};
  arr.forEach((item, index) => {
    obj[index] = item;
  });
  return obj;
};

/**
 * Synthesizes before/after objects from a list of JSON-patch changes so the
 * pair can be diffed. Exported for tests.
 */
export const synthesizeComparable = (
  changes: JsonChange[]
): [Record<string, unknown>, Record<string, unknown>] => {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const budget: GrowthBudget = { remaining: kArrayGrowthBudget };

  for (const change of changes) {
    switch (change.op) {
      case "add":
        // 'Fill in' arrays with empty strings to ensure there is no unnecessary diff
        initializeArrays(before, change.path, budget);
        initializeArrays(after, change.path, budget);
        setPath(after, change.path, change.value, budget);
        break;
      case "copy":
        setPath(before, change.path, change.value, budget);
        setPath(after, change.path, change.value, budget);
        break;
      case "move":
        setPath(before, change.from || "", change.value, budget);
        setPath(after, change.path, change.value, budget);
        break;
      case "remove":
        setPath(before, change.path, change.value, budget);
        break;
      case "replace":
        // 'Fill in' arrays with empty strings to ensure there is no unnecessary diff
        initializeArrays(before, change.path, budget);
        initializeArrays(after, change.path, budget);

        setPath(before, change.path, change.replaced, budget);
        setPath(after, change.path, change.value, budget);
        break;
      case "test":
        break;
    }
  }
  reconcileContainerKinds(before, after);
  return [before, after];
};

/**
 * Aligns container kinds between the two synthesized sides. Ops that write
 * only one side (remove, move, copy) skip initializeArrays, so a mixed-key
 * re-key can fire on one side only — and jsondiffpatch renders array-vs-object
 * at the same path as a whole-value swap instead of key-level edits.
 */
function reconcileContainerKinds(a: PathContainer, b: PathContainer): void {
  const keys = Array.isArray(a)
    ? a.map((_, index) => String(index))
    : Object.keys(a);
  for (const key of keys) {
    const leftRaw = getChild(a, key);
    const rightRaw = getChild(b, key);
    if (!isPathContainer(leftRaw) || !isPathContainer(rightRaw)) continue;
    let left: PathContainer = leftRaw;
    let right: PathContainer = rightRaw;
    if (Array.isArray(left) && !Array.isArray(right)) {
      left = arrayToObject(left);
      setChild(a, key, left);
    } else if (Array.isArray(right) && !Array.isArray(left)) {
      right = arrayToObject(right);
      setChild(b, key, right);
    }
    reconcileContainerKinds(left, right);
  }
}

/**
 * Sets a value at a path in an object
 */
function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
  budget: GrowthBudget
): void {
  const keys = parsePath(path);
  let current: PathContainer = target;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    if (!key || !nextKey) return;
    const existing = getChild(current, key);
    // A scalar already here gets overwritten: a change list writing /a and
    // then /a/b onto the same side loses the /a scalar. Coherent jsonpatch
    // output doesn't produce that shape, so we accept the (silent) drop
    // rather than complicate the synthesis.
    const next = containerFor(existing, nextKey, budget);
    if (next !== existing) {
      setChild(current, key, next);
    }
    current = next;
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey) {
    setChild(current, lastKey, value);
  }
}

/**
 * Places structure in an object (without placing values), padding arrays with
 * empty strings up to the path's index so the diff shows no spurious entries.
 */
function initializeArrays(
  target: Record<string, unknown>,
  path: string,
  budget: GrowthBudget
): void {
  const keys = parsePath(path);
  let current: PathContainer = target;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    if (!key || !nextKey) return;

    const next = containerFor(getChild(current, key), nextKey, budget);
    if (Array.isArray(next)) {
      const index = Number(nextKey);
      while (next.length < index) {
        next.push("");
      }
    }
    setChild(current, key, next);
    current = next;
  }
}

/**
 * Parses a path into an array of keys
 */
function parsePath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Checks if a key represents an array index
 */
function isArrayIndex(key: string): boolean {
  return /^\d+$/.test(key);
}

/**
 * Array elements the synthesis may add beyond one-per-change appends. Path
 * indexes come from the log, so without a cap one `/x/2000000000` change
 * pads (or sparsely grows) an array to that length on the render path.
 */
const kArrayGrowthBudget = 10_000;

interface GrowthBudget {
  remaining: number;
}

/**
 * Picks the container that `nextKey` gets written into, reusing `existing`
 * when it fits. A numeric key selects an array only while the budget covers
 * growing it to that index; past that it becomes an object key, the same
 * re-key a mixed numeric/non-numeric dict gets.
 */
function containerFor(
  existing: unknown,
  nextKey: string,
  budget: GrowthBudget
): PathContainer {
  if (isPathContainer(existing) && !Array.isArray(existing)) {
    // A plain object holds numeric-string keys fine.
    return existing;
  }
  const arr: unknown[] = Array.isArray(existing) ? existing : [];
  if (isArrayIndex(nextKey) && reserveIndex(arr, Number(nextKey), budget)) {
    return arr;
  }
  return arr.length > 0 ? arrayToObject(arr) : {};
}

/**
 * Charges the budget for growing `arr` to hold `index`. Appending the next
 * element is free: it takes a change per element, so it's already bounded
 * by the change list.
 */
function reserveIndex(
  arr: unknown[],
  index: number,
  budget: GrowthBudget
): boolean {
  const growth = index - arr.length;
  if (growth <= 0) return true;
  if (growth > budget.remaining) return false;
  budget.remaining -= growth;
  return true;
}
