import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { FC, RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import { kTranscriptCollapseScope } from "@tsmono/inspect-components/transcript";

import {
  candidateOutlineRows,
  defaultCollapsedSpanIds,
  type ChunkedSample,
  type OutlineRow,
} from "../../../../log_data";
import { useStore } from "../../../../state/store";

import { ChunkedRowView, rowNodeId } from "./ChunkedRowView";
import styles from "./ChunkedTranscriptPanel.module.css";
import { useChunkedRows } from "./useChunkedRows";

interface ChunkedTranscriptPanelProps {
  id: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  offsetTop?: number;
  chunked: ChunkedSample;
}

/**
 * The transcript for a chunked-shape sample: a row-window list model over
 * the RowSpace (the forked seam named in design/large-samples.md — shared
 * per-event row renderers, second window model) plus a skeleton-only
 * outline. Rows materialize as they scroll into view; everything above the
 * data layer is estimate-then-correct with ordinal re-anchoring.
 */
export const ChunkedTranscriptPanel: FC<ChunkedTranscriptPanelProps> = ({
  id,
  scrollRef,
  offsetTop,
  chunked,
}) => {
  const hiddenTypes = useStore(
    (state) => state.sample.eventFilter.filteredTypes
  );
  const collapsedOverrides = useStore(
    (state) => state.sample.collapsedEvents?.[kTranscriptCollapseScope]
  );
  const collapseEvent = useStore((state) => state.sampleActions.collapseEvent);

  const defaultCollapsed = useMemo(
    () => defaultCollapsedSpanIds(chunked.skeleton),
    [chunked]
  );
  const rows = useChunkedRows(
    chunked,
    collapsedOverrides,
    defaultCollapsed,
    hiddenTypes
  );

  const outline = useMemo(
    () => candidateOutlineRows(chunked.skeleton),
    [chunked]
  );

  const virtualizer = useVirtualizer({
    count: rows.total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    paddingStart: offsetTop,
    getItemKey: (index) => {
      const slot = rows.slotAt(index);
      return slot.kind === "row" ? rowNodeId(slot.row) : `ph-${index}`;
    },
  });

  // materialize the chunks under visible placeholders (idempotent)
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    for (const item of items) {
      const slot = rows.slotAt(item.index);
      if (slot.kind === "placeholder") {
        rows.materialize(slot.chunkIdx);
      }
    }
  }, [items, rows]);

  // Ordinal anchoring (spec amendment 3): row-count corrections above the
  // viewport shift content, so track the topmost visible ordinal and
  // re-scroll to its corrected row index whenever accounting changes.
  const anchorRef = useRef<number | undefined>(undefined);
  const versionRef = useRef(rows.version);
  useEffect(() => {
    if (rows.version !== versionRef.current) {
      versionRef.current = rows.version;
      if (anchorRef.current !== undefined) {
        virtualizer.scrollToIndex(rows.rowIndexForOrdinal(anchorRef.current), {
          align: "start",
        });
      }
    }
  });
  useEffect(() => {
    const first = items.find((item) => rows.slotAt(item.index).kind === "row");
    if (first !== undefined) {
      const slot = rows.slotAt(first.index);
      if (slot.kind === "row") {
        anchorRef.current = slot.row.ordinal;
      }
    }
  }, [items, rows]);

  const eventCallbacks = useMemo(
    () => ({
      getCollapsed: (nodeId: string) => rows.isCollapsed(nodeId),
      onCollapse: (nodeId: string, collapsed: boolean) => {
        collapseEvent(kTranscriptCollapseScope, nodeId, collapsed);
      },
    }),
    [rows, collapseEvent]
  );

  const jumpToOrdinal = useCallback(
    (ordinal: number) => {
      anchorRef.current = ordinal;
      virtualizer.scrollToIndex(rows.rowIndexForOrdinal(ordinal), {
        align: "start",
      });
    },
    [virtualizer, rows]
  );

  return (
    <div className={styles.layout} data-testid={`${id}-chunked`}>
      <nav
        className={styles.outline}
        style={{ top: offsetTop ?? 0, maxHeight: "80vh" }}
      >
        {outline.map((row, i) => (
          <OutlineRowView key={i} row={row} onJump={jumpToOrdinal} />
        ))}
      </nav>
      <div
        className={styles.list}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const slot = rows.slotAt(item.index);
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className={styles.row}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {slot.kind === "row" ? (
                <div
                  style={{
                    paddingLeft: `${
                      slot.row.depth <= 1
                        ? slot.row.depth * 0.7
                        : (0.7 + slot.row.depth - 1) * 1
                    }em`,
                  }}
                >
                  <ChunkedRowView
                    row={slot.row}
                    eventCallbacks={eventCallbacks}
                  />
                </div>
              ) : (
                <div className={styles.placeholder} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const OutlineRowView: FC<{
  row: OutlineRow;
  onJump: (ordinal: number) => void;
}> = ({ row, onJump }) => {
  const label =
    row.kind === "turns"
      ? `${row.total} turn${row.total === 1 ? "" : "s"}`
      : row.kind === "scoring"
        ? "scoring"
        : (row.name ?? row.type ?? row.kind);
  return (
    <button
      type="button"
      className={clsx(
        styles.outlineRow,
        row.kind === "turns" && styles.outlineTurns
      )}
      style={{ paddingLeft: `${0.4 + row.depth * 0.8}em` }}
      onClick={
        row.anchor !== undefined ? () => onJump(row.anchor ?? 0) : undefined
      }
    >
      {label}
    </button>
  );
};
