import clsx from "clsx";
import { FC, Fragment, ReactNode, useState } from "react";

import type { ConfigChangeInfo } from "@tsmono/inspect-common/utils";
import { PopOver } from "@tsmono/react/components";

import styles from "./ConfigChangedChip.module.css";

/** Scalar-ish config values render plain; structures fall back to JSON. */
export const formatConfigValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "none";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
};

const scopeLabel = (change: ConfigChangeInfo): string =>
  change.inherited ? `${change.scope} · inherited` : change.scope;

interface TimelineLinkProps {
  onClick: () => void;
}

const TimelineLink: FC<TimelineLinkProps> = ({ onClick }) => (
  <button type="button" className={styles.timelineLink} onClick={onClick}>
    <i className="bi bi-graph-up" aria-hidden="true" />
    View on timeline
  </button>
);

interface ProvenanceGridProps {
  change: ConfigChangeInfo;
}

const ProvenanceGrid: FC<ProvenanceGridProps> = ({ change }) => (
  <div className={styles.popoverGrid}>
    <div className={styles.popoverLabel}>Author</div>
    <div>{change.provenance.author}</div>
    <div className={styles.popoverLabel}>Time</div>
    <div>{formatTimestamp(change.provenance.timestamp)}</div>
    <div className={styles.popoverLabel}>Scope</div>
    <div style={{ display: "flex" }}>
      <span className={styles.scopePill}>{scopeLabel(change)}</span>
    </div>
    {change.provenance.reason ? (
      <Fragment>
        <div className={styles.popoverLabel}>Reason</div>
        <div>{change.provenance.reason}</div>
      </Fragment>
    ) : null}
  </div>
);

interface HoverChipProps {
  id: string;
  chipClassName?: string;
  chipContent: ReactNode;
  children: ReactNode;
}

/** A pill that reveals a hover-persistent popover (~200ms open delay). */
const HoverChip: FC<HoverChipProps> = ({
  id,
  chipClassName,
  chipContent,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [chipEl, setChipEl] = useState<HTMLElement | null>(null);

  return (
    <Fragment>
      <span
        ref={setChipEl}
        className={clsx(styles.chip, chipClassName)}
        onMouseEnter={() => setIsOpen(true)}
      >
        {chipContent}
      </span>
      <PopOver
        id={id}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        positionEl={chipEl}
        placement="bottom-start"
        showArrow={false}
        hoverDelay={200}
        className={styles.popover}
        styles={{ padding: 0 }}
      >
        {children}
      </PopOver>
    </Fragment>
  );
};

interface ConfigChangedChipProps {
  change: ConfigChangeInfo;
  /** The folded value shown in the cell — the launch value when cleared. */
  effectiveValue?: unknown;
  /** Compact chip: omit the scope / limit-lifted detail from the label. */
  compact?: boolean;
  onViewTimeline?: () => void;
}

/**
 * The "changed" affordance used on every config surface: violet ◆ pill for
 * mid-run changes (gray for cleared overrides), with a hover popover showing
 * the transition and full provenance.
 */
export const ConfigChangedChip: FC<ConfigChangedChipProps> = ({
  change,
  effectiveValue,
  compact,
  onViewTimeline,
}) => {
  const chipLabel = change.cleared
    ? "override cleared → launch value"
    : compact
      ? "changed"
      : change.limitLifted
        ? "changed · limit lifted"
        : change.scope === "process"
          ? "changed · process"
          : "changed";

  return (
    <HoverChip
      id={`config-changed-${change.config}-${change.name}`}
      chipClassName={change.cleared ? styles.chipCleared : undefined}
      chipContent={
        <Fragment>
          {!change.cleared ? <span className={styles.diamond} /> : null}
          {chipLabel}
        </Fragment>
      }
    >
      <div className={styles.popoverHeader}>
        {!change.cleared ? <span className={styles.diamond} /> : null}
        <span className={styles.popoverKnob}>{change.name}</span>
        <span className={styles.popoverHeaderNote}>
          {change.cleared ? "override cleared" : "changed mid-run"}
        </span>
      </div>
      <div className={styles.popoverBody}>
        <div className={styles.popoverTransition}>
          {change.cleared ? (
            <Fragment>
              <span className={styles.from}>override cleared → </span>
              <span className={styles.to}>
                launch value
                {effectiveValue !== undefined
                  ? ` (${formatConfigValue(effectiveValue)})`
                  : ""}
              </span>
            </Fragment>
          ) : (
            <Fragment>
              <span className={styles.from}>
                {formatConfigValue(change.previous)} →{" "}
              </span>
              <span className={styles.to}>
                {change.value === null ? "null" : formatConfigValue(change.value)}
              </span>
              {change.limitLifted ? (
                <span className={styles.from}> (limit lifted)</span>
              ) : null}
            </Fragment>
          )}
        </div>
        <ProvenanceGrid change={change} />
        {onViewTimeline ? <TimelineLink onClick={onViewTimeline} /> : null}
      </div>
    </HoverChip>
  );
};

interface ConfigValueCellProps {
  /** The folded (effective) value for this knob. */
  value: unknown;
  change: ConfigChangeInfo;
  compact?: boolean;
  onViewTimeline?: () => void;
}

/**
 * A config grid value cell for a changed knob: effective value first,
 * struck-through prior beside it, then the changed chip. Cleared knobs show
 * the launch value with no strikethrough (the value isn't new).
 */
export const ConfigValueCell: FC<ConfigValueCellProps> = ({
  value,
  change,
  compact,
  onViewTimeline,
}) => {
  const showPrior =
    !change.cleared &&
    change.previous !== undefined &&
    change.previous !== change.value;

  return (
    <div className={styles.cell}>
      <span
        className={clsx(
          change.cleared ? styles.clearedValue : styles.effectiveValue,
          value === null || value === undefined ? styles.noneValue : undefined
        )}
      >
        {formatConfigValue(value)}
      </span>
      {showPrior ? (
        <span className={styles.priorValue}>
          <s>{formatConfigValue(change.previous)}</s>
        </span>
      ) : null}
      <ConfigChangedChip
        change={change}
        effectiveValue={value}
        compact={compact}
        onViewTimeline={onViewTimeline}
      />
    </div>
  );
};

interface ConfigChangesCountChipProps {
  changes: ConfigChangeInfo[];
  id?: string;
  onViewTimeline?: () => void;
}

/**
 * Aggregate "N changed" chip (SecondaryBar): hover lists the changed knobs.
 */
export const ConfigChangesCountChip: FC<ConfigChangesCountChipProps> = ({
  changes,
  id = "config-changes-count",
  onViewTimeline,
}) => {
  if (changes.length === 0) {
    return null;
  }

  return (
    <HoverChip
      id={id}
      chipContent={
        <Fragment>
          <span className={styles.diamond} />
          {changes.length} changed
        </Fragment>
      }
    >
      <div className={styles.popoverHeader}>
        <span className={styles.diamond} />
        <span className={styles.popoverHeaderNote}>changed mid-run</span>
      </div>
      <div className={styles.popoverBody}>
        <div className={styles.changeList}>
          {changes.map((change) => (
            <div key={`${change.config}-${change.name}`}>
              {change.name}{" "}
              {change.cleared ? (
                <span className={styles.from}>
                  override cleared → launch value
                </span>
              ) : (
                <Fragment>
                  <span className={styles.from}>
                    {formatConfigValue(change.previous)} →{" "}
                  </span>
                  <span className={styles.to}>
                    {change.value === null
                      ? "null"
                      : formatConfigValue(change.value)}
                  </span>
                  {change.limitLifted ? (
                    <span className={styles.from}> (limit lifted)</span>
                  ) : null}
                </Fragment>
              )}
            </div>
          ))}
        </div>
        {onViewTimeline ? <TimelineLink onClick={onViewTimeline} /> : null}
      </div>
    </HoverChip>
  );
};
