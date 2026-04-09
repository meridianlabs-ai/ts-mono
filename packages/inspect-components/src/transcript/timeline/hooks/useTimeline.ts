/**
 * Timeline state hook.
 *
 * Provides a fully expanded, flat timeline view. All descendant spans are
 * always visible — there is no drill-down navigation. Selection is key-based,
 * using the unique tree-position key from each SwimlaneRow.
 *
 * Selection state is owned by the caller via `selected` / `onSelect` props,
 * so both apps can persist it however they like (URL params, Zustand, etc.).
 */

import { useCallback, useMemo } from "react";

import type { Timeline, TimelineSpan } from "../core";
import { computeFlatSwimlaneRows, type SwimlaneRow } from "../swimlaneRows";

// =============================================================================
// Types
// =============================================================================

export interface TimelineState {
  /** The root TimelineSpan (always the timeline root). */
  node: TimelineSpan;
  /** Flat swimlane rows for all descendants. */
  rows: SwimlaneRow[];
  /** Currently selected row key, or null. */
  selected: string | null;
  /** Select a row by key, or null to clear. */
  select: (key: string | null) => void;
  /** Clear the selection (returns to default root selection). */
  clearSelection: () => void;
}

// =============================================================================
// Branch Lookup (used by branch marker popover)
// =============================================================================

export interface BranchLookupResult {
  /** The span that owns the branches. */
  owner: TimelineSpan;
  /** Matching branches with their 1-indexed position. */
  branches: Array<{ branch: TimelineSpan; index: number }>;
}

/**
 * Finds all branches matching a branchedFrom UUID anywhere in the span tree.
 * Returns the owning span and matching branches.
 */
export function findBranchesByBranchedFrom(
  node: TimelineSpan,
  branchedFrom: string
): BranchLookupResult | null {
  // Check this node's branches
  const matches: Array<{ branch: TimelineSpan; index: number }> = [];
  for (let i = 0; i < node.branches.length; i++) {
    const branch = node.branches[i]!;
    if (branch.branchedFrom === branchedFrom) {
      matches.push({ branch, index: i + 1 });
    }
  }
  if (matches.length > 0) {
    return { owner: node, branches: matches };
  }

  // Recurse into child spans
  for (const item of node.content) {
    if (item.type === "span") {
      const found = findBranchesByBranchedFrom(item, branchedFrom);
      if (found) return found;
    }
  }

  return null;
}

// =============================================================================
// Hook
// =============================================================================

export interface TimelineOptions {
  /** Include utility agents in the swimlane rows. Default: false. */
  includeUtility?: boolean;
  /** Show branches as swimlane rows. Default: false. */
  showBranches?: boolean;
  /** Position branches at their fork point instead of wall-clock time. Default: false. */
  forkRelative?: boolean;
}

export interface UseTimelineProps {
  /** Currently selected row key (externally managed). Null = root selection. */
  selected: string | null;
  /** Called when the user selects a row. Null = clear selection. */
  onSelect: (key: string | null) => void;
}

/**
 * Timeline state hook.
 *
 * Computes a fully expanded flat list of swimlane rows from the timeline root.
 * Selection is driven by the caller via `props.selected` / `props.onSelect`.
 */
export function useTimeline(
  timeline: Timeline,
  options?: TimelineOptions,
  props?: UseTimelineProps
): TimelineState {
  const includeUtility = options?.includeUtility ?? false;
  const showBranchesOption = options?.showBranches ?? false;

  const selectedParam = props?.selected ?? null;
  const onSelect = props?.onSelect;

  // Force branches on when the URL selection references a branch row,
  // so that reloading a page with a branch selected works even if the
  // persistent showBranches preference is off.
  const showBranches =
    showBranchesOption ||
    (selectedParam !== null && /\/branch-/.test(selectedParam));

  // Always use the root node
  const node = timeline.root;

  // Compute flat swimlane rows for the entire tree
  const rows = useMemo(
    () => computeFlatSwimlaneRows(node, { includeUtility, showBranches }),
    [node, includeUtility, showBranches]
  );

  // Default selection: explicit param > root row key.
  const selected = useMemo(() => {
    if (selectedParam !== null) return selectedParam;
    return rows[0]?.key ?? null;
  }, [selectedParam, rows]);

  const select = useCallback(
    (key: string | null) => {
      onSelect?.(key);
    },
    [onSelect]
  );

  const clearSelection = useCallback(() => {
    onSelect?.(null);
  }, [onSelect]);

  return {
    node,
    rows,
    selected,
    select,
    clearSelection,
  };
}
