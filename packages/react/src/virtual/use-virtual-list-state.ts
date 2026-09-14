import { useCallback } from "react";

import { useProperty } from "../hooks/useProperty";

import type { VirtualListStateSnapshot } from "./types";

const CURRENT_VERSION = 1 as const;

export type UseVirtualListStateResult = {
  getRestoreSnapshot: () => VirtualListStateSnapshot | undefined;
  recordSnapshot: (snapshot: VirtualListStateSnapshot) => void;
};

export function useVirtualListState(
  persistenceKey: string,
  enabled = true
): UseVirtualListStateResult {
  const [stored, setStored] = useProperty<VirtualListStateSnapshot | null>(
    persistenceKey,
    "snapshot",
    { defaultValue: null }
  );

  const getRestoreSnapshot = useCallback(():
    VirtualListStateSnapshot | undefined => {
    if (!enabled || !stored) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (stored.version !== CURRENT_VERSION) return undefined;
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
