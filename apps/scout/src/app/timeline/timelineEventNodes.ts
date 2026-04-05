/**
 * Bridge from timeline spans to raw Event[] for the transcript display pipeline.
 *
 * Resolves the selected swimlane row to TimelineSpan(s), then walks their
 * content trees to produce a flat Event[] that can be fed through useEventNodes.
 * Child TimelineSpans are re-emitted as synthetic span_begin/span_end events
 * so treeifyEvents can reconstruct the hierarchy.
 */

import type {
  TimelineEvent,
  TimelineSpan,
} from "../../components/transcript/timeline";
import { createBranchSpan } from "../../components/transcript/timeline";
import { EventNode } from "../../components/transcript/types";
import type {
  Event,
  SpanBeginEvent,
  SpanEndEvent,
} from "../../types/api-types";

import type { MinimapSelection } from "./components/TimelineMinimap";

import {
  getAgents,
  isSingleSpan,
  type SwimlaneRow,
} from "./utils/swimlaneRows";

// =============================================================================
// Selection parsing
// =============================================================================

/**
 * Parsed selection: a row key with optional span index and region index.
 *
 * Format: `"rowKey"` selects the whole row, `"rowKey:N"` selects
 * span index N (0-based) within an iterative row, `"rowKey@R"` selects
 * compaction region R, and `"rowKey:N@R"` selects region R of span N.
 */
export interface ParsedSelection {
  rowKey: string;
  spanIndex: number | null;
  regionIndex: number | null;
}

/**
 * Parses a selection string into row key + optional span index + optional region index.
 * Returns null for null/empty input.
 *
 * Parse order: extract `@R` from end first, then `:N` from what remains.
 */
export function parseSelection(
  selected: string | null
): ParsedSelection | null {
  if (!selected) return null;

  // Extract @R region suffix first
  let regionIndex: number | null = null;
  let rest = selected;
  const atIdx = rest.lastIndexOf("@");
  if (atIdx !== -1) {
    const regionSuffix = rest.slice(atIdx + 1);
    const r = Number(regionSuffix);
    if (Number.isInteger(r) && r >= 0) {
      regionIndex = r;
      rest = rest.slice(0, atIdx);
    }
  }

  // Extract :N span index from the remainder
  const colonIdx = rest.lastIndexOf(":");
  if (colonIdx === -1) {
    return { rowKey: rest, spanIndex: null, regionIndex };
  }
  const suffix = rest.slice(colonIdx + 1);
  const idx = Number(suffix);
  if (!Number.isInteger(idx) || idx < 0) {
    // Not a valid span index — treat the whole remaining string as the row key
    return { rowKey: rest, spanIndex: null, regionIndex };
  }
  return { rowKey: rest.slice(0, colonIdx), spanIndex: idx, regionIndex };
}

/**
 * Builds a selection string from row key + optional span index + optional region index.
 */
export function buildSelectionKey(
  rowKey: string,
  spanIndex?: number,
  regionIndex?: number
): string {
  let key = rowKey;
  if (spanIndex !== undefined) key = `${key}:${spanIndex}`;
  if (regionIndex !== undefined) key = `${key}@${regionIndex}`;
  return key;
}

// =============================================================================
// Row lookup
// =============================================================================

/** Find a swimlane row by key. */
function findRowByKey(
  rows: SwimlaneRow[],
  key: string
): SwimlaneRow | undefined {
  return rows.find((r) => r.key === key);
}

/**
 * Derive the branch prefix for nested branches from a selected row.
 *
 * If the row is a branch named "Branch 1", returns "1." so nested branches
 * become "Branch 1.1", "Branch 1.2", etc. Returns "" for non-branch rows.
 */
export function getBranchPrefix(
  rows: SwimlaneRow[],
  selected: string | null
): string {
  const parsed = parseSelection(selected);
  if (!parsed) return "";
  const row = findRowByKey(rows, parsed.rowKey);
  if (!row?.branch) return "";
  const match = /^Branch (\S+)$/i.exec(row.name);
  return match ? `${match[1]}.` : "";
}

// =============================================================================
// Selected spans
// =============================================================================

/**
 * Resolves the selected swimlane row key to TimelineSpan(s).
 *
 * When the selection includes a span index (e.g. `"explore:1"`), returns
 * only that specific span. Otherwise returns all spans from the row.
 */
export function getSelectedSpans(
  rows: SwimlaneRow[],
  selected: string | null
): TimelineSpan[] {
  const parsed = parseSelection(selected);
  if (!parsed) return [];

  const row = findRowByKey(rows, parsed.rowKey);
  if (!row) return [];

  // Sub-selection: return only the indexed span
  if (parsed.spanIndex !== null) {
    const span = row.spans[parsed.spanIndex];
    if (!span) return [];
    return isSingleSpan(span) ? [span.agent] : getAgents(span);
  }

  // Whole row: return all spans
  const result: TimelineSpan[] = [];
  for (const rowSpan of row.spans) {
    if (isSingleSpan(rowSpan)) {
      result.push(rowSpan.agent);
    } else {
      result.push(...getAgents(rowSpan));
    }
  }
  return result;
}

// =============================================================================
// Minimap selection
// =============================================================================

/**
 * Computes the minimap selection for the currently selected swimlane row.
 *
 * When a span index is present, shows just that span's range.
 * When a region index is present, narrows to the region's time range.
 * Otherwise shows the full row's range.
 */
export function computeMinimapSelection(
  rows: SwimlaneRow[],
  selected: string | null
): MinimapSelection | undefined {
  const parsed = parseSelection(selected);
  if (!parsed) return undefined;
  const row = findRowByKey(rows, parsed.rowKey);
  if (!row) return undefined;

  // Determine which spans to include
  const spans =
    parsed.spanIndex !== null
      ? row.spans[parsed.spanIndex]
        ? [row.spans[parsed.spanIndex]!]
        : []
      : row.spans;

  const allAgents = spans.flatMap(getAgents);
  if (allAgents.length === 0) return undefined;

  // Region-scoped minimap: narrow to the region's time range
  if (parsed.regionIndex !== null && allAgents.length === 1) {
    const agent = allAgents[0]!;
    const regions = computeCompactionRegions(agent.content);
    const region = regions[parsed.regionIndex];
    if (region && region.length > 0) {
      const times = region.flatMap((item) =>
        item.type === "event"
          ? [item.startTime(), item.endTime()]
          : [item.startTime(), item.endTime()]
      );
      const startTime = new Date(Math.min(...times.map((t) => t.getTime())));
      const endTime = new Date(Math.max(...times.map((t) => t.getTime())));
      const tokens = region.reduce((sum, item) => sum + item.totalTokens(), 0);
      return { startTime, endTime, totalTokens: tokens };
    }
  }

  if (allAgents.length === 1) {
    const agent = allAgents[0]!;
    return {
      startTime: agent.startTime(false),
      endTime: agent.endTime(false),
      totalTokens: agent.totalTokens(false),
    };
  }

  // Compute envelope with includeBranches=false so each agent contributes
  // only its own time range
  let envStart = allAgents[0]!.startTime(false);
  let envEnd = allAgents[0]!.endTime(false);
  for (let i = 1; i < allAgents.length; i++) {
    const a = allAgents[i]!;
    if (a.startTime(false) < envStart) envStart = a.startTime(false);
    if (a.endTime(false) > envEnd) envEnd = a.endTime(false);
  }
  const tokens = allAgents.reduce((sum, a) => sum + a.totalTokens(false), 0);
  return { startTime: envStart, endTime: envEnd, totalTokens: tokens };
}

// =============================================================================
// Compaction region computation
// =============================================================================

/**
 * Partitions a content array into regions separated by compaction events.
 *
 * Returns an array of content slices. If no compaction events exist, returns
 * a single-element array containing the full content.
 */
export function computeCompactionRegions(
  content: ReadonlyArray<TimelineEvent | TimelineSpan>
): ReadonlyArray<TimelineEvent | TimelineSpan>[] {
  const regions: (TimelineEvent | TimelineSpan)[][] = [];
  let current: (TimelineEvent | TimelineSpan)[] = [];

  for (const item of content) {
    if (item.type === "event" && item.event.event === "compaction") {
      regions.push(current);
      current = [];
    } else {
      current.push(item);
    }
  }
  regions.push(current);
  return regions;
}

// =============================================================================
// Collected events
// =============================================================================

export interface CollectedEvents {
  events: Event[];
  /** Agent spans keyed by span ID, for attaching to EventNodes after tree construction. */
  sourceSpans: Map<string, TimelineSpan>;
}

/**
 * Collects raw Event[] from TimelineSpan content trees.
 *
 * When a single span is provided, walks its content directly (the span itself
 * is the implicit context). When multiple spans are provided, each is wrapped
 * in synthetic span_begin/span_end events so treeifyEvents can reconstruct
 * the grouping (e.g. parallel agents shown as collapsible sections).
 *
 * Agent spans (spanType === "agent") are emitted as empty span_begin/span_end
 * pairs with no child events — their content is accessed by selecting the
 * swimlane row. The returned sourceSpans map allows attaching the original
 * TimelineSpan to the resulting EventNodes for rich rendering.
 *
 * When `regionIndex` is set, only events from that compaction region are emitted.
 */
export function collectRawEvents(
  spans: TimelineSpan[],
  options?: {
    includeUtility?: boolean;
    regionIndex?: number | null;
    showBranches?: boolean;
    branchPrefix?: string;
  }
): CollectedEvents {
  const includeUtility = options?.includeUtility ?? false;
  const regionIndex = options?.regionIndex ?? null;
  const showBranches = options?.showBranches ?? false;
  const branchPrefix = options?.branchPrefix ?? "";
  const events: Event[] = [];
  const sourceSpans = new Map<string, TimelineSpan>();
  if (spans.length === 1) {
    // When viewing a single agent span, the spawning ToolEvent (which wraps
    // the entire agent execution) duplicates the first MODEL CALL's input and
    // the last ASSISTANT response. Detect and skip it at the top level only.
    const span = spans[0]!;
    const agentSpanId = span.spanType === "agent" ? span.id : undefined;

    // If a region is selected, window the content to that region
    let content: ReadonlyArray<TimelineEvent | TimelineSpan> = span.content;
    if (regionIndex !== null) {
      const regions = computeCompactionRegions(span.content);
      if (regionIndex >= 0 && regionIndex < regions.length) {
        content = regions[regionIndex]!;
      }
    }

    collectFromContent(
      content,
      events,
      sourceSpans,
      agentSpanId,
      includeUtility,
      showBranches,
      span.branches.length > 0 ? span.branches : undefined,
      branchPrefix
    );
  } else {
    // Multiple spans: wrap each in span_begin/span_end so the event tree
    // groups them, matching the drilled-in container behavior.
    // Region selection does not apply to multi-span views.
    collectFromContent(
      spans,
      events,
      sourceSpans,
      undefined,
      includeUtility,
      showBranches,
      undefined,
      branchPrefix
    );
  }
  return { events, sourceSpans };
}

/**
 * Emit a single branch as an empty span_begin/span_end pair (like agents).
 * Content is accessed by selecting the branch swimlane row.
 */
function emitBranchSpan(
  branch: TimelineSpan,
  label: string,
  out: Event[],
  sourceSpans: Map<string, TimelineSpan>,
  parentSpanId?: string | null
): void {
  const branchSpan = createBranchSpan(branch, label);
  sourceSpans.set(branchSpan.id, branchSpan);

  const branchBegin: SpanBeginEvent = {
    event: "span_begin",
    name: branchSpan.name,
    id: branchSpan.id,
    span_id: branchSpan.id,
    type: branchSpan.spanType,
    timestamp: branchSpan.startTime().toISOString(),
    parent_id: parentSpanId ?? null,
    pending: false,
    working_start: 0,
    uuid: branchSpan.id,
    metadata: null,
  };
  out.push(branchBegin);

  const branchEnd: SpanEndEvent = {
    event: "span_end",
    id: `${branchSpan.id}-end`,
    span_id: branchSpan.id,
    timestamp: branchSpan.endTime().toISOString(),
    pending: false,
    working_start: 0,
    uuid: null,
    metadata: null,
  };
  out.push(branchEnd);
}

function collectFromContent(
  content: ReadonlyArray<TimelineEvent | TimelineSpan>,
  out: Event[],
  sourceSpans: Map<string, TimelineSpan>,
  skipAgentSpanId?: string,
  includeUtility: boolean = false,
  showBranches: boolean = false,
  branches?: ReadonlyArray<TimelineSpan>,
  branchPrefix: string = ""
): void {
  // Track agent tool_call_ids whose results are shown on the AgentCard,
  // so we can filter them from the next model event's input.
  const pendingToolCallIds = new Set<string>();

  // Build a lookup from branchedFrom UUID → branches for inline emission.
  // Branches whose branchedFrom doesn't match any event are emitted at the end.
  const branchByBranchedFrom = new Map<string, TimelineSpan[]>();
  if (branches) {
    for (const branch of branches) {
      if (branch.branchedFrom) {
        const existing = branchByBranchedFrom.get(branch.branchedFrom);
        if (existing) {
          existing.push(branch);
        } else {
          branchByBranchedFrom.set(branch.branchedFrom, [branch]);
        }
      }
    }
  }
  const emittedBranchedFroms = new Set<string>();

  for (const item of content) {
    if (item.type === "event") {
      // Skip the spawning ToolEvent when viewing a sub-agent's own content.
      // Match the specific agent_span_id so we only skip the tool that
      // spawned this exact agent, not any other agent-spawning tool.
      if (
        skipAgentSpanId &&
        item.event.event === "tool" &&
        item.event.agent_span_id === skipAgentSpanId
      ) {
        continue;
      }

      // Filter agent tool results from model event inputs — these are
      // already shown on the AgentCard, so don't duplicate them inline.
      if (item.event.event === "model" && pendingToolCallIds.size > 0) {
        const modelEvent = item.event;
        if (modelEvent.input && Array.isArray(modelEvent.input)) {
          const filteredInput = (
            modelEvent.input as Array<Record<string, unknown>>
          ).filter(
            (msg) =>
              !(
                msg.role === "tool" &&
                typeof msg.tool_call_id === "string" &&
                pendingToolCallIds.has(msg.tool_call_id)
              )
          );
          if (filteredInput.length !== modelEvent.input.length) {
            // Mark the event so ModelEventView knows agent tool results were
            // filtered and it should not crawl backward through input messages.
            const patched = {
              ...modelEvent,
              input: filteredInput,
              agentResultsFiltered: true,
            } as unknown as Event;
            out.push(patched);
            pendingToolCallIds.clear();
            // Emit branches forked at this event after the event itself
            emitInlineBranches(
              item,
              branchByBranchedFrom,
              branches ?? [],
              emittedBranchedFroms,
              out,
              sourceSpans,
              branchPrefix
            );
            continue;
          }
        }
      }

      out.push(item.event);

      // Emit branches forked at this event immediately after it
      emitInlineBranches(
        item,
        branchByBranchedFrom,
        branches ?? [],
        emittedBranchedFroms,
        out,
        sourceSpans,
        branchPrefix
      );
    } else if (!includeUtility && item.utility) {
      // Skip utility spans — internal model calls (e.g. file path extraction)
      // that should not appear in the event tree or outline.
      continue;
    } else {
      // Emit synthetic span_begin
      const beginEvent: SpanBeginEvent = {
        event: "span_begin",
        name: item.name,
        id: item.id,
        span_id: item.id,
        type: item.spanType,
        timestamp: item.startTime().toISOString(),
        parent_id: null,
        pending: false,
        working_start: 0,
        uuid: item.id,
        metadata: null,
      };
      out.push(beginEvent);

      if (item.spanType === "agent") {
        // Agent spans: emit empty begin/end pair. Content is accessed
        // by selecting the swimlane row, not by expanding in-place.
        sourceSpans.set(item.id, item);
        // Track agent tool_call_ids with results for filtering from next model event
        if (item.agentResult && item.id.startsWith("agent-")) {
          pendingToolCallIds.add(item.id.slice(6));
        }
      } else {
        // Non-agent spans: recurse into child content, passing their
        // own branches so they emit inline at the correct fork point.
        collectFromContent(
          item.content,
          out,
          sourceSpans,
          undefined,
          includeUtility,
          showBranches,
          item.branches.length > 0 ? item.branches : undefined
        );
      }

      // Emit synthetic span_end
      const endEvent: SpanEndEvent = {
        event: "span_end",
        id: `${item.id}-end`,
        span_id: item.id,
        timestamp: item.endTime().toISOString(),
        pending: false,
        working_start: 0,
        uuid: null,
        metadata: null,
      };
      out.push(endEvent);
    }
  }

  // Emit any branches whose branchedFrom didn't match any event in this content
  // (fallback to end, preserving previous behavior for unresolvable forks).
  if (branches) {
    for (const branch of branches) {
      const branchedFrom = branch.branchedFrom ?? "";
      if (!emittedBranchedFroms.has(branchedFrom)) {
        const label = `${branchPrefix}${branches.indexOf(branch) + 1}`;
        emitBranchSpan(branch, label, out, sourceSpans);
      }
    }
  }
}

/**
 * Emit branches inline after their fork point event.
 */
function emitInlineBranches(
  item: TimelineEvent,
  branchByBranchedFrom: ReadonlyMap<string, TimelineSpan[]>,
  allBranches: ReadonlyArray<TimelineSpan>,
  emittedBranchedFroms: Set<string>,
  out: Event[],
  sourceSpans: Map<string, TimelineSpan>,
  branchPrefix: string = ""
): void {
  // branchByBranchedFrom is keyed by message ID. Find entries where
  // this event produced or carries the matching message ID.
  for (const [messageId, forkedBranches] of branchByBranchedFrom) {
    if (emittedBranchedFroms.has(messageId)) continue;
    if (!item.matchesMessageId(messageId)) continue;

    // Use the fork event's span_id as the branch's parent so treeifyEvents
    // nests the branch inside the same span as the fork event.
    const parentSpanId = (item.event as { span_id?: string | null }).span_id;
    for (const branch of forkedBranches) {
      // Use the branch's position in the full branches array for the display label
      const globalIndex = allBranches.indexOf(branch);
      const label = `${branchPrefix}${(globalIndex >= 0 ? globalIndex : 0) + 1}`;
      emitBranchSpan(branch, label, out, sourceSpans, parentSpanId);
    }
    emittedBranchedFroms.add(messageId);
  }
}

// =============================================================================
// Branch context collection
// =============================================================================

/**
 * Derives the parent row key from a branch row key.
 *
 * Branch keys follow the pattern `"parentKey/branch-{branchedFrom}-{index}"`.
 * Returns null if the key doesn't contain a branch segment.
 */
export function getParentKeyFromBranch(branchKey: string): string | null {
  const match = /^(.+)\/branch-[^/]+$/.exec(branchKey);
  return match ? match[1]! : null;
}

/** A link in the ancestor chain: a span and the fork message ID where the next level branches. */
interface AncestorLink {
  span: TimelineSpan;
  forkMessageId: string;
}

/**
 * Builds the ancestor chain from a branch row up to the outermost non-branch row.
 *
 * Returns links ordered outermost ancestor → innermost parent, each paired
 * with the fork UUID where the next level (or the target branch) branches off.
 */
function buildAncestorChain(
  rows: SwimlaneRow[],
  branchRowKey: string
): AncestorLink[] {
  const chain: AncestorLink[] = [];
  let currentKey = branchRowKey;

  while (true) {
    const parentKey = getParentKeyFromBranch(currentKey);
    if (!parentKey) break;

    const parentRow = rows.find((r) => r.key === parentKey);
    if (!parentRow || parentRow.spans.length === 0) break;

    // Get the parent's TimelineSpan
    const firstSpan = parentRow.spans[0]!;
    const parentSpan = isSingleSpan(firstSpan)
      ? firstSpan.agent
      : getAgents(firstSpan)[0];
    if (!parentSpan) break;

    // Get the child branch's branchedFrom identifier
    const childRow = rows.find((r) => r.key === currentKey);
    if (!childRow || childRow.spans.length === 0) break;
    const childFirstSpan = childRow.spans[0]!;
    const childSpan = isSingleSpan(childFirstSpan)
      ? childFirstSpan.agent
      : getAgents(childFirstSpan)[0];
    if (!childSpan?.branchedFrom) break;

    chain.unshift({ span: parentSpan, forkMessageId: childSpan.branchedFrom });

    currentKey = parentKey;
    // Keep walking if the parent is also a branch
    if (!parentRow.branch) break;
  }

  return chain;
}

/**
 * Collects events from a span's content, stopping after the event whose
 * message ID matches `forkMessageId` (inclusive — the fork event is the
 * last parent event before the branch point).
 *
 * Returns true if the fork event was found, false otherwise.
 */
function collectContentUpToFork(
  content: ReadonlyArray<TimelineEvent | TimelineSpan>,
  forkMessageId: string,
  out: Event[],
  sourceSpans: Map<string, TimelineSpan>,
  includeUtility: boolean
): boolean {
  for (const item of content) {
    if (item.type === "event") {
      out.push(item.event);
      if (item.matchesMessageId(forkMessageId)) {
        return true;
      }
    } else if (!includeUtility && item.utility) {
      continue;
    } else if (item.spanType === "agent") {
      // Agent spans: emit collapsed begin/end pair
      const beginEvent: SpanBeginEvent = {
        event: "span_begin",
        name: item.name,
        id: item.id,
        span_id: item.id,
        type: item.spanType,
        timestamp: item.startTime().toISOString(),
        parent_id: null,
        pending: false,
        working_start: 0,
        uuid: item.id,
        metadata: null,
      };
      out.push(beginEvent);
      sourceSpans.set(item.id, item);
      const endEvent: SpanEndEvent = {
        event: "span_end",
        id: `${item.id}-end`,
        span_id: item.id,
        timestamp: item.endTime().toISOString(),
        pending: false,
        working_start: 0,
        uuid: null,
        metadata: null,
      };
      out.push(endEvent);
    } else {
      // Non-agent span: recurse into content, checking for fork
      const beginEvent: SpanBeginEvent = {
        event: "span_begin",
        name: item.name,
        id: item.id,
        span_id: item.id,
        type: item.spanType,
        timestamp: item.startTime().toISOString(),
        parent_id: null,
        pending: false,
        working_start: 0,
        uuid: item.id,
        metadata: null,
      };
      out.push(beginEvent);

      const found = collectContentUpToFork(
        item.content,
        forkMessageId,
        out,
        sourceSpans,
        includeUtility
      );

      const endEvent: SpanEndEvent = {
        event: "span_end",
        id: `${item.id}-end`,
        span_id: item.id,
        timestamp: item.endTime().toISOString(),
        pending: false,
        working_start: 0,
        uuid: null,
        metadata: null,
      };
      out.push(endEvent);

      if (found) return true;
    }
  }
  return false;
}

/**
 * Collects events for a branch with full ancestor context.
 *
 * The resulting event stream contains:
 * 1. Ancestor events from the root down to each fork point
 * 2. A branch separator (AgentCardView) at each fork
 * 3. The branch's own events
 *
 * For nested branches (Branch 1.1), the full chain is included:
 * root events → fork → Branch 1 events → fork → Branch 1.1 events.
 */
export function collectBranchWithContext(
  rows: SwimlaneRow[],
  branchRowKey: string,
  branchSpan: TimelineSpan,
  options: {
    includeUtility: boolean;
    showBranches: boolean;
    branchPrefix: string;
  }
): CollectedEvents {
  const events: Event[] = [];
  const sourceSpans = new Map<string, TimelineSpan>();

  const ancestorChain = buildAncestorChain(rows, branchRowKey);

  // Emit each ancestor's content up to its fork point
  for (const ancestor of ancestorChain) {
    collectContentUpToFork(
      ancestor.span.content,
      ancestor.forkMessageId,
      events,
      sourceSpans,
      options.includeUtility
    );
  }

  // Emit the branch separator (renders as AgentCardView).
  // branchSpan is already a createBranchSpan result with the correct name,
  // so emit directly rather than calling emitBranchSpan (which would
  // double-apply createBranchSpan and produce "Branch Branch 1").
  sourceSpans.set(branchSpan.id, branchSpan);
  const branchBegin: SpanBeginEvent = {
    event: "span_begin",
    name: branchSpan.name,
    id: branchSpan.id,
    span_id: branchSpan.id,
    type: branchSpan.spanType,
    timestamp: branchSpan.startTime().toISOString(),
    parent_id: null,
    pending: false,
    working_start: 0,
    uuid: branchSpan.id,
    metadata: null,
  };
  events.push(branchBegin);
  const branchEnd: SpanEndEvent = {
    event: "span_end",
    id: `${branchSpan.id}-end`,
    span_id: branchSpan.id,
    timestamp: branchSpan.endTime().toISOString(),
    pending: false,
    working_start: 0,
    uuid: null,
    metadata: null,
  };
  events.push(branchEnd);

  // Emit the branch's own content
  collectFromContent(
    branchSpan.content,
    events,
    sourceSpans,
    undefined,
    options.includeUtility,
    options.showBranches,
    branchSpan.branches.length > 0 ? branchSpan.branches : undefined,
    options.branchPrefix
  );

  return { events, sourceSpans };
}

// =============================================================================
// Span select key lookup
// =============================================================================

export interface SpanSelectKey {
  /** The row key to select. */
  key: string;
}

/**
 * Builds a lookup from span ID to the selection key needed to select that span
 * in the swimlane UI.
 *
 * For rows with multiple spans (iterative), each span ID maps to a key with
 * the span index suffix (e.g. `"explore:0"`). For single-span rows, the key
 * is just the row key.
 */
export function buildSpanSelectKeys(
  rows: SwimlaneRow[]
): ReadonlyMap<string, SpanSelectKey> {
  const keys = new Map<string, SpanSelectKey>();
  for (const row of rows) {
    const hasMultipleSpans = row.spans.length > 1;
    for (let i = 0; i < row.spans.length; i++) {
      const rowSpan = row.spans[i]!;
      const selectKey = hasMultipleSpans
        ? buildSelectionKey(row.key, i)
        : row.key;
      if (isSingleSpan(rowSpan)) {
        keys.set(rowSpan.agent.id, { key: selectKey });
      } else {
        for (const agent of getAgents(rowSpan)) {
          keys.set(agent.id, { key: selectKey });
        }
      }
    }
  }
  return keys;
}

// =============================================================================
// Source span attachment
// =============================================================================

/**
 * Walks the EventNode tree and attaches sourceSpan to any span_begin node
 * whose span_id matches an entry in the map. This links synthetic span events
 * back to their original TimelineSpan for rich rendering.
 */
export function attachSourceSpans(
  nodes: EventNode[],
  spanMap: ReadonlyMap<string, TimelineSpan>
): void {
  for (const node of nodes) {
    if (node.event.event === "span_begin") {
      const spanId = node.event.span_id;
      if (spanId) {
        const span = spanMap.get(spanId);
        if (span) node.sourceSpan = span;
      }
    }
    if (node.children.length > 0) {
      attachSourceSpans(node.children, spanMap);
    }
  }
}
