import { FC } from "react";

import { PopOver } from "@tsmono/react/components";

import type { UseTimelineConfigResult } from "../hooks/useTimelineConfig";
import type { MarkerKind } from "../markers";

import styles from "./TimelineOptionsPopover.module.css";

// =============================================================================
// Types
// =============================================================================

interface TimelineOptionsPopoverProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  positionEl: HTMLElement | null;
  config: UseTimelineConfigResult;
  /** Called when the branches toggle is clicked (handles selection cleanup). */
  onToggleBranches: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const kMarkerKindLabels: Array<{ kind: MarkerKind; label: string }> = [
  { kind: "error", label: "Errors" },
  { kind: "compaction", label: "Compaction" },
];

// =============================================================================
// Component
// =============================================================================

export const TimelineOptionsPopover: FC<TimelineOptionsPopoverProps> = ({
  isOpen,
  setIsOpen,
  positionEl,
  config,
  onToggleBranches,
}) => {
  return (
    <PopOver
      id="timeline-options-popover"
      positionEl={positionEl}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      placement="bottom-end"
      hoverDelay={-1}
    >
      <div className={`${styles.title} text-size-smaller`}>View Options</div>
      <div className={`${styles.rows} text-size-smaller`}>
        {kMarkerKindLabels.map(({ kind, label }) => (
          <label key={kind} className={styles.row}>
            <input
              type="checkbox"
              checked={config.markerKinds.includes(kind)}
              onChange={() => config.toggleMarkerKind(kind)}
            />
            {label}
          </label>
        ))}
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={config.includeUtility}
            onChange={() => config.setIncludeUtility(!config.includeUtility)}
          />
          Utility agents
        </label>

        <div className={styles.groupHeader}>Branches</div>
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={config.showBranches}
            onChange={onToggleBranches}
          />
          Show branches
        </label>
        {config.showBranches && (
          <>
            <label className={styles.row}>
              <input
                type="checkbox"
                checked={config.forkRelative}
                onChange={() => config.setForkRelative(!config.forkRelative)}
              />
              Fork-relative branches
            </label>
            <label className={styles.row}>
              <input
                type="checkbox"
                checked={config.showEmptyBranches}
                onChange={() =>
                  config.setShowEmptyBranches(!config.showEmptyBranches)
                }
              />
              Show empty branches
            </label>
          </>
        )}
      </div>
    </PopOver>
  );
};
