import clsx from "clsx";
import { FC, ReactNode, useRef, useState } from "react";

import { useUnmount } from "@tsmono/react/hooks";
import { Icon } from "@tsmono/react/icons";

import { formatClock } from "./format";
import { useTerminalClock, type TerminalClock } from "./terminalClock";
import {
  kPlaybackSpeeds,
  kSharedIdleLimit,
  playbackToReal,
  type TerminalSample,
} from "./terminalModel";
import styles from "./Terminals.module.css";

// Hovering the folded timeline this long (ms) peeks the full lanes.
const kPeekDelayMs = 150;

interface TerminalControlsProps {
  playing: boolean;
  ended: boolean;
  onTogglePlay: () => void;
  clock: TerminalClock;
  sample: TerminalSample;
  speed: number;
  onSpeedChange: (speed: number) => void;
  /** Shown while the user holds a row other than the agent's. */
  hold?: { session: string; agentSession?: string };
  onFollow: () => void;
  /** What's at the playhead, while the user drags it. */
  scrubPreview?: string;
  /** The view's own controls (fullscreen, or in fullscreen the agent picker
   *  and the exit), right of the speed. */
  tools?: ReactNode;
  timelineFolded: boolean;
  onToggleTimeline: () => void;
  /** The folded timeline (the focused session's lane), inline in the
   *  control row. */
  foldedTimeline: ReactNode;
  /** The full timeline, under the control row or peeked over the stage
   *  while hovering the folded one. */
  timeline: ReactNode;
}

/** The shared view's play button, readout, chips, speed and timeline (brief
 *  §6), in one strip under the stage. */
export const TerminalControls: FC<TerminalControlsProps> = ({
  playing,
  ended,
  onTogglePlay,
  clock,
  sample,
  speed,
  onSpeedChange,
  hold,
  onFollow,
  scrubPreview,
  tools,
  timelineFolded,
  onToggleTimeline,
  foldedTimeline,
  timeline,
}) => {
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const endPeek = () => {
    window.clearTimeout(peekTimer.current);
    setPeek(false);
  };
  useUnmount(() => window.clearTimeout(peekTimer.current));

  return (
    <div className={styles.controls} onPointerLeave={endPeek}>
      {timelineFolded && peek ? (
        <div className={styles.peek}>{timeline}</div>
      ) : null}
      <div className={styles.controlRow}>
        <button
          type="button"
          className={styles.playButton}
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : ended ? "Replay" : "Play"}
          title={playing ? "Pause (Space)" : ended ? "Replay" : "Play (Space)"}
        >
          <Icon name={playing ? "pause" : ended ? "retry" : "play"} />
        </button>
        <ClockReadout clock={clock} sample={sample} />
        {timelineFolded ? null : (
          <span
            className={styles.readoutNote}
            title={`Replays in ${formatClock(sample.playbackDuration)}: stretches where every terminal is idle are shortened to ${kSharedIdleLimit} s.`}
          >
            idle time skipped
          </span>
        )}
        {scrubPreview ? (
          <span className={clsx(styles.chip, styles.scrubChip)}>
            {scrubPreview}
          </span>
        ) : hold ? (
          <button
            type="button"
            className={clsx(styles.chip, styles.holdChip)}
            onClick={onFollow}
            title="Follow the agent again (F)"
          >
            holding {hold.session}
            {hold.agentSession ? ` · agent is in ${hold.agentSession}` : ""} —
            follow again
          </button>
        ) : null}
        {timelineFolded ? (
          <span
            className={styles.foldedTimeline}
            onPointerEnter={() => {
              window.clearTimeout(peekTimer.current);
              peekTimer.current = window.setTimeout(
                () => setPeek(true),
                kPeekDelayMs
              );
            }}
            onPointerLeave={() => window.clearTimeout(peekTimer.current)}
          >
            {foldedTimeline}
          </span>
        ) : (
          <span className={styles.controlSpacer} />
        )}
        <span
          className={styles.speedGroup}
          role="group"
          aria-label="Playback speed"
        >
          {kPlaybackSpeeds.map((option) => (
            <button
              key={option}
              type="button"
              className={clsx(
                styles.speedButton,
                speed === option && styles.speedButtonActive
              )}
              aria-pressed={speed === option}
              onClick={() => onSpeedChange(option)}
            >
              {option}×
            </button>
          ))}
        </span>
        {tools ? <span className={styles.controlTools}>{tools}</span> : null}
        <button
          type="button"
          className={styles.timelineToggle}
          onClick={() => {
            endPeek();
            onToggleTimeline();
          }}
          aria-label={timelineFolded ? "Show timeline" : "Fold timeline"}
          title={timelineFolded ? "Show timeline" : "Fold timeline"}
        >
          <Icon
            name="chevronDown"
            className={clsx(
              styles.timelineChevron,
              timelineFolded && styles.timelineChevronFolded
            )}
          />
        </button>
      </div>
      {timelineFolded ? null : timeline}
    </div>
  );
};

// Follows the clock itself, once a second, so the view needn't re-render for
// it.
const ClockReadout: FC<{ clock: TerminalClock; sample: TerminalSample }> = ({
  clock,
  sample,
}) => {
  const seconds = useTerminalClock(clock, (playback) =>
    Math.round(playbackToReal(sample, playback))
  );
  return (
    <span className={styles.readout} aria-label="Elapsed in the run">
      <span className={styles.readoutElapsed}>{formatClock(seconds)}</span>
      <span className={styles.readoutTotal}>
        / {formatClock(sample.duration)}
      </span>
    </span>
  );
};
