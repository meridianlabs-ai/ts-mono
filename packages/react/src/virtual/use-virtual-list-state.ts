import { useCallback } from "react";

import { useProperty } from "../hooks/useProperty";

import type { VirtualListStateSnapshot } from "./types";

const CURRENT_VERSION = 2 as const;

// Older mounts persisted a raw scroll offset under the same key.
type StoredSnapshot =
  | VirtualListStateSnapshot
  | { version: 1; scrollOffset: number; totalCount: number };

export type UseVirtualListStateResult = {
  getRestoreSnapshot: () => VirtualListStateSnapshot | undefined;
  recordSnapshot: (snapshot: VirtualListStateSnapshot) => void;
};

export function useVirtualListState(
  persistenceKey: string
): UseVirtualListStateResult {
  const [stored, setStored] = useProperty<StoredSnapshot | null>(
    persistenceKey,
    "snapshot",
    { defaultValue: null }
  );

  const getRestoreSnapshot = useCallback(():
    VirtualListStateSnapshot | undefined => {
    if (!stored || stored.version !== CURRENT_VERSION) return undefined;
    return stored;
  }, [stored]);

  const recordSnapshot = useCallback(
    (snapshot: VirtualListStateSnapshot) => {
      setStored(snapshot);
    },
    [setStored]
  );

  return { getRestoreSnapshot, recordSnapshot };
}
