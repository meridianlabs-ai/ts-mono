import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  resolvedEventsReader,
  RowSpace,
  type ChunkedSample,
  type DecodeCtx,
  type RowSlot,
} from "../../../../log_data";

export interface ChunkedRowsModel {
  /** Bumps whenever row accounting changes (corrections, materializations). */
  version: number;
  total: number;
  slotAt: (globalIndex: number) => RowSlot;
  /** Kick off decode of a placeholder's chunk (idempotent, deduped). */
  materialize: (chunkIdx: number) => void;
  rowIndexForOrdinal: (ordinal: number) => number;
  /** Effective collapsed span ids (store overrides over defaults). */
  isCollapsed: (spanId: string) => boolean;
}

/**
 * The row-window model for a chunked sample's transcript: a RowSpace
 * (estimate-then-correct row accounting over event chunks) rebuilt when the
 * filter or collapse state changes. Rebuilds are cheap — estimates come
 * from the stats sidecar and re-materialization re-parses from the byte
 * store, not the network.
 */
export const useChunkedRows = (
  chunked: ChunkedSample,
  collapsedOverrides: Record<string, boolean> | undefined,
  defaultCollapsedIds: ReadonlySet<string>,
  hiddenTypes: readonly string[]
): ChunkedRowsModel => {
  const visible = useMemo(() => {
    const hidden = new Set(hiddenTypes);
    return (type: string) => !hidden.has(type);
  }, [hiddenTypes]);

  const collapsed = useMemo(() => {
    const ids = new Set<string>();
    for (const span of chunked.skeleton.spans) {
      const override = collapsedOverrides?.[span.id];
      if (override ?? defaultCollapsedIds.has(span.id)) {
        ids.add(span.id);
      }
    }
    return ids;
  }, [chunked, collapsedOverrides, defaultCollapsedIds]);

  const events = useMemo(() => resolvedEventsReader(chunked), [chunked]);

  const { rowSpace, ctx } = useMemo(() => {
    const rowSpace = new RowSpace(
      events,
      chunked.stats,
      chunked.skel,
      collapsed,
      visible
    );
    const ctx: DecodeCtx = {
      events,
      stats: chunked.stats,
      skel: chunked.skel,
      isCollapsed: (spanId) => collapsed.has(spanId),
      visible,
    };
    return { rowSpace, ctx };
  }, [events, chunked, collapsed, visible]);

  const version = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => rowSpace.onChange(onChange),
      [rowSpace]
    ),
    () => rowSpace.version
  );

  return useMemo(
    () => ({
      version,
      total: rowSpace.total,
      slotAt: (globalIndex) => rowSpace.slotAt(globalIndex),
      materialize: (chunkIdx) => {
        rowSpace.materialize(chunkIdx, ctx).catch((error: unknown) => {
          console.error(`Failed to materialize chunk ${chunkIdx}`, error);
        });
      },
      rowIndexForOrdinal: (ordinal) => rowSpace.rowIndexForOrdinal(ordinal),
      isCollapsed: (spanId) => collapsed.has(spanId),
    }),
    [rowSpace, ctx, version, collapsed]
  );
};
