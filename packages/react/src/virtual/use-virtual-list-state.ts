import { useCallback } from "react";

import { isRecord } from "@tsmono/util";

import { useProperty } from "../hooks/useProperty";

import type { VirtualListStateSnapshot } from "./types";

const CURRENT_VERSION = 1 as const;

export type UseVirtualListStateResult = {
  getRestoreSnapshot: () => VirtualListStateSnapshot | undefined;
  recordSnapshot: (snapshot: VirtualListStateSnapshot) => void;
};

// The snapshot lives in a persisted property bag, so a restored value may be
// from an older shape or version.
const isCurrentSnapshot = (value: unknown): value is VirtualListStateSnapshot =>
  isRecord(value) &&
  value["version"] === CURRENT_VERSION &&
  typeof value["scrollOffset"] === "number" &&
  typeof value["totalCount"] === "number";

export function useVirtualListState(
  persistenceKey: string,
  enabled = true
): UseVirtualListStateResult {
  const [stored, setStored] = useProperty<unknown>(persistenceKey, "snapshot", {
    defaultValue: null,
  });

  const getRestoreSnapshot = useCallback(():
    VirtualListStateSnapshot | undefined => {
    if (!enabled || !isCurrentSnapshot(stored)) return undefined;
    return stored;
  }, [stored, enabled]);

  const recordSnapshot = useCallback(
    (snapshot: VirtualListStateSnapshot) => {
      if (enabled) setStored(snapshot);
    },
    [setStored, enabled]
  );

  return { getRestoreSnapshot, recordSnapshot };
}
