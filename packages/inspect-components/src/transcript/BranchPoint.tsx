import clsx from "clsx";
import { CSSProperties, FC, Fragment, MouseEvent } from "react";

import { hueForBranch } from "./branchColor";
import styles from "./BranchPoint.module.css";

export interface BranchPointProps {
  /** Branch that already existed and continues past this fork. */
  parent: string;
  /** Branches born at this fork, in display order. */
  spawned: string[];
  /** The branch the viewer is currently reading. Must equal `parent` or one of `spawned`. */
  viewing: string;
  /**
   * Called when a non-current radio is clicked. The second arg is the clicked
   * element so the host can scroll-anchor (preserves viewport position after
   * the selection change re-renders the transcript list).
   */
  onSelect?: (branch: string, anchorEl: HTMLElement) => void;
  /** Optional explicit hue (0..360) per branch label. */
  branchHue?: Record<string, number>;
  className?: string;
}

export const BranchPoint: FC<BranchPointProps> = ({
  parent,
  spawned,
  viewing,
  onSelect,
  branchHue,
  className,
}) => {
  if (spawned.length === 0) return null;

  const hueOf = (b: string): number => {
    const override = branchHue?.[b];
    return override != null ? override : hueForBranch(b);
  };

  return (
    <div
      role="group"
      aria-label="Branch point"
      className={clsx(styles.branchPoint, className)}
    >
      <div className={styles.row}>
        <span className={styles.glyph} aria-hidden="true" />
        <span className={styles.label}>Branch point</span>
        <RadioPill
          branch={parent}
          hue={hueOf(parent)}
          filled={viewing === parent}
          onSelect={onSelect}
        />
      </div>
      <div className={styles.connectorRow}>
        <Elbow />
        <div className={styles.spawnedRow}>
          {spawned.map((b, i) => (
            <Fragment key={b}>
              {i > 0 && (
                <span
                  className={styles.orPipe}
                  aria-hidden="true"
                  data-testid="bp-or"
                />
              )}
              <RadioPill
                branch={b}
                hue={hueOf(b)}
                filled={viewing === b}
                onSelect={onSelect}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

interface RadioPillProps {
  branch: string;
  hue: number;
  filled: boolean;
  onSelect?: (branch: string, anchorEl: HTMLElement) => void;
}

const RadioPill: FC<RadioPillProps> = ({ branch, hue, filled, onSelect }) => {
  const interactive = !!onSelect && !filled;
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    if (interactive && onSelect) {
      onSelect(branch, e.currentTarget);
    }
  };
  const style = { "--bp-hue": hue } as CSSProperties;
  return (
    <button
      type="button"
      className={styles.pill}
      style={style}
      data-interactive={interactive ? "true" : "false"}
      data-testid="bp-pill"
      data-branch={branch}
      aria-pressed={filled ? "true" : "false"}
      onClick={interactive ? handleClick : undefined}
      disabled={!interactive}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span>{branch}</span>
    </button>
  );
};

const Elbow: FC = () => (
  <svg width="76" height="34" viewBox="0 0 76 34" aria-hidden="true">
    <path d="M 42 0 V 20 H 76" className={styles.elbow} />
  </svg>
);
