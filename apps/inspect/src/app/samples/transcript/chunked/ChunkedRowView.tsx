import { FC, useMemo } from "react";

import {
  EventNode,
  EventPanel,
  isDiffOnlyStateChange,
  RenderedEventNode,
  type EventPanelCallbacks,
} from "@tsmono/inspect-components/transcript";
import { formatDateTime } from "@tsmono/util";

import {
  type ChunkedEvent,
  type SkeletonSpan,
  type ViewRow,
} from "../../../../log_data";

/** Stable row identity: event uuid when present, else the sequence ordinal. */
export const rowNodeId = (row: ViewRow): string => {
  if (row.kind === "span") {
    return row.span.id;
  }
  const ev = row.kind === "event" ? row.ev : row.sample;
  const uuid = "uuid" in ev ? ev.uuid : undefined;
  return typeof uuid === "string" ? uuid : `ordinal-${row.ordinal}`;
};

const eventNode = (ev: ChunkedEvent, id: string, depth: number): EventNode =>
  new EventNode(id, ev, depth);

const summarizeChildren = (span: SkeletonSpan): string => {
  const parts = Object.entries(span.children).map(
    ([type, count]) => `${count} ${type} event${count === 1 ? "" : "s"}`
  );
  return parts.length > 0 ? parts.join(", ") : "(no events)";
};

interface ChunkedRowViewProps {
  row: ViewRow;
  eventCallbacks?: EventPanelCallbacks;
  /** The user's recorded collapse choices, over each event's default. */
  collapsedOverrides?: Record<string, boolean>;
}

/**
 * One decoded view row: event rows render through the shared per-event
 * renderers; span rows render from the skeleton span (its begin event body
 * may be unfetched — collapsing a span covering a million events costs
 * nothing); runs render as one merged row.
 */
export const ChunkedRowView: FC<ChunkedRowViewProps> = ({
  row,
  eventCallbacks,
  collapsedOverrides,
}) => {
  const node = useMemo(
    () =>
      row.kind === "event"
        ? eventNode(row.ev, rowNodeId(row), row.depth)
        : undefined,
    [row]
  );

  if (row.kind === "span") {
    const span = row.span;
    const title = span.type ? `${span.type}: ${span.name}` : span.name;
    return (
      <EventPanel
        eventNodeId={span.id}
        muted
        // any non-empty list enables the collapse chevron; contents are
        // windowed rows, never nested children
        childIds={[`${span.id}#contents`]}
        title={title}
        subTitle={formatDateTime(new Date(span.t[0]))}
        text={summarizeChildren(span)}
        depth={row.depth}
        eventCallbacks={eventCallbacks}
      />
    );
  }

  if (row.kind === "run") {
    return (
      <EventPanel
        eventNodeId={rowNodeId(row)}
        muted
        title={`${row.count} ${row.runType} events`}
        depth={row.depth}
      />
    );
  }

  if (!node) return null;
  // Same default as the full transcript (computeDefaultCollapsedIds); the
  // chunked tree is built from spans, so each event row applies its own.
  const callbacks =
    eventCallbacks && isDiffOnlyStateChange(node.event)
      ? {
          ...eventCallbacks,
          getCollapsed: (id: string) =>
            id === node.id
              ? (collapsedOverrides?.[id] ?? true)
              : (eventCallbacks.getCollapsed?.(id) ?? false),
        }
      : eventCallbacks;
  return <RenderedEventNode node={node} eventCallbacks={callbacks} />;
};
