/**
 * Persistent configuration for timeline options (markers, agents).
 *
 * Each setting is stored via `useProperty` under the "timeline" id namespace
 * so values persist in the store across unmounts.
 */

import { useCallback, useMemo } from "react";

import {
  defaultMarkerConfig,
  type MarkerConfig,
  type MarkerDepth,
  type MarkerKind,
} from "@tsmono/inspect-components/transcript";
import { useProperty } from "@tsmono/react/hooks";

import type { TimelineOptions } from "./useTimeline";

// =============================================================================
// Types
// =============================================================================

export interface UseTimelineConfigResult {
  /** Resolved MarkerConfig for the timeline pipeline. */
  markerConfig: MarkerConfig;
  /** Resolved TimelineOptions for the timeline pipeline. */
  agentConfig: TimelineOptions;

  /** Current marker kinds selection. */
  markerKinds: MarkerKind[];
  /** Current marker depth selection. */
  markerDepth: MarkerDepth;
  /** Whether utility agents are shown. */
  includeUtility: boolean;
  /** Whether branches are shown as swimlane rows. */
  showBranches: boolean;
  /** Whether branches are positioned at their fork point. */
  forkRelative: boolean;

  setMarkerKinds: (kinds: MarkerKind[]) => void;
  setMarkerDepth: (depth: MarkerDepth) => void;
  setIncludeUtility: (include: boolean) => void;
  setShowBranches: (show: boolean) => void;
  setForkRelative: (forkRelative: boolean) => void;
  toggleMarkerKind: (kind: MarkerKind) => void;
  resetToDefaults: () => void;
  /** True when all settings match their defaults. */
  isDefault: boolean;
}

// =============================================================================
// Defaults
// =============================================================================

const kDefaultMarkerKinds = defaultMarkerConfig.kinds;
const kDefaultMarkerDepth = defaultMarkerConfig.depth;
const kDefaultIncludeUtility = false;
const kDefaultShowBranches = false;
const kDefaultForkRelative = false;

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sorted1 = [...a].sort();
  const sorted2 = [...b].sort();
  return sorted1.every((v, i) => v === sorted2[i]);
}

// =============================================================================
// Hook
// =============================================================================

export function useTimelineConfig(): UseTimelineConfigResult {
  const [storedKinds, setStoredKinds] = useProperty<MarkerKind[]>(
    "timeline",
    "markerKinds"
  );
  const [storedDepth, setStoredDepth] = useProperty<MarkerDepth>(
    "timeline",
    "markerDepth"
  );
  const [storedUtility, setStoredUtility] = useProperty<boolean>(
    "timeline",
    "includeUtility"
  );
  const [storedShowBranches, setStoredShowBranches] = useProperty<boolean>(
    "timeline",
    "showBranches"
  );
  const [storedForkRelative, setStoredForkRelative] = useProperty<boolean>(
    "timeline",
    "forkRelative"
  );

  const markerKinds = storedKinds ?? kDefaultMarkerKinds;
  const markerDepth = storedDepth ?? kDefaultMarkerDepth;
  const includeUtility = storedUtility ?? kDefaultIncludeUtility;
  const showBranches = storedShowBranches ?? kDefaultShowBranches;
  // Default fork-relative to on when branches are shown and the user hasn't
  // explicitly toggled it (storedForkRelative is undefined).
  const forkRelative =
    storedForkRelative ?? (showBranches || kDefaultForkRelative);

  const markerConfig: MarkerConfig = useMemo(
    () => ({ kinds: markerKinds, depth: markerDepth }),
    [markerKinds, markerDepth]
  );

  const agentConfig: TimelineOptions = useMemo(
    () => ({ includeUtility, showBranches, forkRelative }),
    [includeUtility, showBranches, forkRelative]
  );

  const isDefault =
    arraysEqual(markerKinds, kDefaultMarkerKinds) &&
    markerDepth === kDefaultMarkerDepth &&
    includeUtility === kDefaultIncludeUtility &&
    showBranches === kDefaultShowBranches &&
    forkRelative === kDefaultForkRelative;

  const toggleMarkerKind = useCallback(
    (kind: MarkerKind) => {
      const current = storedKinds ?? kDefaultMarkerKinds;
      const next = current.includes(kind)
        ? current.filter((k) => k !== kind)
        : [...current, kind];
      setStoredKinds(next);
    },
    [storedKinds, setStoredKinds]
  );

  const resetToDefaults = useCallback(() => {
    setStoredKinds(kDefaultMarkerKinds);
    setStoredDepth(kDefaultMarkerDepth);
    setStoredUtility(kDefaultIncludeUtility);
    setStoredShowBranches(kDefaultShowBranches);
    setStoredForkRelative(kDefaultForkRelative);
  }, [
    setStoredKinds,
    setStoredDepth,
    setStoredUtility,
    setStoredShowBranches,
    setStoredForkRelative,
  ]);

  return {
    markerConfig,
    agentConfig,
    markerKinds,
    markerDepth,
    includeUtility,
    showBranches,
    forkRelative,
    setMarkerKinds: setStoredKinds,
    setMarkerDepth: setStoredDepth,
    setIncludeUtility: setStoredUtility,
    setShowBranches: setStoredShowBranches,
    setForkRelative: setStoredForkRelative,
    toggleMarkerKind,
    resetToDefaults,
    isDefault,
  };
}
