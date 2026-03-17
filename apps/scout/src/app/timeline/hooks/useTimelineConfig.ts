/**
 * Persistent configuration for timeline options (markers, agents).
 *
 * Each setting is stored via `useProperty` under the "timeline" id namespace
 * with `cleanup: false` so values survive unmount and persist across sessions.
 */

import { useCallback, useMemo } from "react";

import { useProperty } from "../../../state/hooks/useProperty";
import type { MarkerConfig, MarkerDepth, MarkerKind } from "../utils/markers";
import { defaultMarkerConfig } from "../utils/markers";

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

  setMarkerKinds: (kinds: MarkerKind[]) => void;
  setMarkerDepth: (depth: MarkerDepth) => void;
  setIncludeUtility: (include: boolean) => void;
  setShowBranches: (show: boolean) => void;
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
    "markerKinds",
    { cleanup: false }
  );
  const [storedDepth, setStoredDepth] = useProperty<MarkerDepth>(
    "timeline",
    "markerDepth",
    { cleanup: false }
  );
  const [storedUtility, setStoredUtility] = useProperty<boolean>(
    "timeline",
    "includeUtility",
    { cleanup: false }
  );
  const [storedShowBranches, setStoredShowBranches] = useProperty<boolean>(
    "timeline",
    "showBranches",
    { cleanup: false }
  );

  const markerKinds = storedKinds ?? kDefaultMarkerKinds;
  const markerDepth = storedDepth ?? kDefaultMarkerDepth;
  const includeUtility = storedUtility ?? kDefaultIncludeUtility;
  const showBranches = storedShowBranches ?? kDefaultShowBranches;

  const markerConfig: MarkerConfig = useMemo(
    () => ({ kinds: markerKinds, depth: markerDepth }),
    [markerKinds, markerDepth]
  );

  const agentConfig: TimelineOptions = useMemo(
    () => ({ includeUtility, showBranches }),
    [includeUtility, showBranches]
  );

  const isDefault =
    arraysEqual(markerKinds, kDefaultMarkerKinds) &&
    markerDepth === kDefaultMarkerDepth &&
    includeUtility === kDefaultIncludeUtility &&
    showBranches === kDefaultShowBranches;

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
  }, [setStoredKinds, setStoredDepth, setStoredUtility, setStoredShowBranches]);

  return {
    markerConfig,
    agentConfig,
    markerKinds,
    markerDepth,
    includeUtility,
    showBranches,
    setMarkerKinds: setStoredKinds,
    setMarkerDepth: setStoredDepth,
    setIncludeUtility: setStoredUtility,
    setShowBranches: setStoredShowBranches,
    toggleMarkerKind,
    resetToDefaults,
    isDefault,
  };
}
