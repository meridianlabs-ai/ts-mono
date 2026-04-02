/**
 * Timeline state hook.
 *
 * Provides a fully expanded, flat timeline view. All descendant spans are
 * always visible — there is no drill-down navigation. Selection is key-based,
 * using the unique tree-position key from each SwimlaneRow.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createBranchSpan,
  type Timeline,
  type TimelineSpan,
} from "../../../components/transcript/timeline";
import {
  computeFlatSwimlaneRows,
  type SwimlaneRow,
} from "../utils/swimlaneRows";

// Re-export so existing consumers don't break.
export { createBranchSpan };

// =============================================================================
// Query Parameter Constants
// =============================================================================

const kSelectedParam = "selected";

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

/**
 * Timeline state hook.
 *
 * Computes a fully expanded flat list of swimlane rows from the timeline root.
 * Selection is driven by the `selected` URL search param using row keys.
 */
export interface TimelineOptions {
  /** Include utility agents in the swimlane rows. Default: false. */
  includeUtility?: boolean;
  /** Show branches as swimlane rows. Default: false. */
  showBranches?: boolean;
}

export function useTimeline(
  timeline: Timeline,
  options?: TimelineOptions
): TimelineState {
  const [searchParams, setSearchParams] = useSearchParams();
  const includeUtility = options?.includeUtility ?? false;
  const showBranchesOption = options?.showBranches ?? false;

  const selectedParam = searchParams.get(kSelectedParam) ?? null;

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
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (key) {
          next.set(kSelectedParam, key);
        } else {
          next.delete(kSelectedParam);
        }
        next.delete("event");
        next.delete("message");
        return next;
      });
    },
    [setSearchParams]
  );

  const clearSelection = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(kSelectedParam);
      next.delete("event");
      next.delete("message");
      return next;
    });
  }, [setSearchParams]);

  return {
    node,
    rows,
    selected,
    select,
    clearSelection,
  };
}
