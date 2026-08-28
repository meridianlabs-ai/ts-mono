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

const getChild = (container: PathContainer, key: string): unknown =>
  Array.isArray(container) ? container[Number(key)] : container[key];

const setChild = (
  container: PathContainer,
  key: string,
  value: unknown
): void => {
  if (Array.isArray(container)) {
    container[Number(key)] = value;
  } else {
    container[key] = value;
  }
};

const asArray = (value: unknown): unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;

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

  for (const change of changes) {
    switch (change.op) {
      case "add":
        // 'Fill in' arrays with empty strings to ensure there is no unnecessary diff
        initializeArrays(before, change.path);
        initializeArrays(after, change.path);
        setPath(after, change.path, change.value);
        break;
      case "copy":
        setPath(before, change.path, change.value);
        setPath(after, change.path, change.value);
        break;
      case "move":
        setPath(before, change.from || "", change.value);
        setPath(after, change.path, change.value);
        break;
      case "remove":
        setPath(before, change.path, change.value);
        break;
      case "replace":
        // 'Fill in' arrays with empty strings to ensure there is no unnecessary diff
        initializeArrays(before, change.path);
        initializeArrays(after, change.path);

        setPath(before, change.path, change.replaced);
        setPath(after, change.path, change.value);
        break;
      case "test":
        break;
    }
  }
  return [before, after];
};

/**
 * Sets a value at a path in an object
 */
function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const keys = parsePath(path);
  let current: PathContainer = target;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) return;
    const nextKey = keys[i + 1];
    const existing = getChild(current, key);
    let next: PathContainer;
    if (isPathContainer(existing)) {
      next =
        Array.isArray(existing) && nextKey && !isArrayIndex(nextKey)
          ? arrayToObject(existing)
          : existing;
      if (next !== existing) {
        setChild(current, key, next);
      }
    } else {
      // If the next key is a number, create an array, otherwise an object.
      // A scalar already here gets overwritten: a change list writing /a and
      // then /a/b onto the same side loses the /a scalar. Coherent jsonpatch
      // output doesn't produce that shape, so we accept the (silent) drop
      // rather than complicate the synthesis.
      next = nextKey && isArrayIndex(nextKey) ? [] : {};
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
 * Places structure in an object (without placing values)
 */
function initializeArrays(target: Record<string, unknown>, path: string): void {
  const keys = parsePath(path);
  let current: PathContainer = target;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    if (!key || !nextKey) {
      continue;
    }

    const existing = getChild(current, key);
    if (isArrayIndex(nextKey)) {
      // A plain object holds numeric-string keys fine — only build (or pad)
      // an array when there's no object here to reuse.
      if (Array.isArray(existing) || !isPathContainer(existing)) {
        setChild(current, key, initializeArray(asArray(existing), nextKey));
      }
    } else if (Array.isArray(existing)) {
      setChild(current, key, arrayToObject(existing));
    } else {
      setChild(current, key, isPathContainer(existing) ? existing : {});
    }

    const next = getChild(current, key);
    if (!isPathContainer(next)) return;
    current = next;
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey && isArrayIndex(lastKey)) {
    initializeArray(asArray(getChild(current, lastKey)), lastKey);
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
 * Initializes an array at a given key, ensuring it is large enough
 */
function initializeArray(
  current: unknown[] | undefined,
  nextKey: string
): unknown[] {
  if (!Array.isArray(current)) {
    current = [];
  }
  const nextKeyIndex = parseInt(nextKey, 10);
  while (current.length < nextKeyIndex) {
    current.push("");
  }
  return current;
}
