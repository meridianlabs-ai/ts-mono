import clsx from "clsx";
import { FC, useRef, useState } from "react";

import {
  AsciinemaPlayer,
  type AsciinemaPlayerHandle,
} from "@tsmono/react/components";
import { useEventListener } from "@tsmono/react/hooks";

import { cssVars } from "../../../utils/cssVars";

import { commandLabel } from "./asciicast";
import { formatClock } from "./format";
import {
  kRowBodyPadding,
  type RowState,
  type TerminalCommand,
  type TerminalSession,
} from "./terminalModel";
import styles from "./Terminals.module.css";

interface TerminalRowProps {
  id: string;
  session: TerminalSession;
  state: Exclude<RowState, "pending">;
  bodyRows: number;
  lineHeight: number;
  lastCommand?: TerminalCommand;
  /** The last output line, for bars without a body. */
  snippet?: string;
  /** Playing: a row that appears flashes its bar. */
  animate: boolean;
  /** A command just landed in this row while the user holds another. */
  pulse: boolean;
  onHold: () => void;
  onToggleFold: () => void;
  /** Set on a held row: its chevron folds it, releasing the hold. */
  onFoldHeld?: () => void;
  onTogglePlay: () => void;
  onKey: (e: KeyboardEvent) => void;
  onPlayer: (player: AsciinemaPlayerHandle | null) => void;
  scrollerRef: (scroller: HTMLDivElement | null) => void;
  /** The user scrolled the body up, away from the newest output. */
  pinned: boolean;
  onJumpToLatest: () => void;
}

/**
 * One terminal session in the shared view: a bar that names it and its last
 * command, and (when the allocation gives it rows) a bottom-anchored body the
 * shared clock drives.
 */
export const TerminalRow: FC<TerminalRowProps> = ({
  id,
  session,
  state,
  bodyRows,
  lineHeight,
  lastCommand,
  snippet,
  animate,
  pulse,
  onHold,
  onToggleFold,
  onFoldHeld,
  onTogglePlay,
  onKey,
  onPlayer,
  scrollerRef,
  pinned,
  onJumpToLatest,
}) => {
  const hasBody = bodyRows > 0;
  // Only a session opening during playback flashes, not every row on load.
  const [flashOnOpen] = useState(animate);
  const showPulse = pulse && state !== "focused" && lastCommand !== undefined;
  const mainTitle =
    state === "focused" || state === "closed"
      ? undefined
      : `Focus ${session.name}`;
  return (
    <div
      className={clsx(
        styles.row,
        state === "focused" && styles.rowFocused,
        state === "open" && styles.rowOpen,
        state === "folded" && styles.rowFolded,
        state === "closed" && styles.rowClosed
      )}
      data-session={session.name}
      data-state={state}
    >
      <div className={styles.bar}>
        {flashOnOpen ? (
          <span className={styles.barFlash} aria-hidden="true" />
        ) : null}
        {showPulse ? (
          // Keyed by the command, so each new one restarts the animation.
          <span
            key={lastCommand.at}
            className={styles.barFlash}
            aria-hidden="true"
          />
        ) : null}
        {state === "focused" && !onFoldHeld ? (
          // The agent's own row: folding it would show nothing until the
          // agent moves on, so the chevron is a plain glyph.
          <span className={styles.chevron} aria-hidden="true">
            ▾
          </span>
        ) : (
          <button
            type="button"
            className={clsx(styles.barButton, styles.chevron)}
            onClick={onFoldHeld ?? onToggleFold}
            aria-expanded={hasBody}
            aria-label={`${hasBody ? "Fold" : "Unfold"} ${session.name}`}
            disabled={state === "closed"}
          >
            {hasBody ? "▾" : "▸"}
          </button>
        )}
        <button
          type="button"
          className={clsx(styles.barButton, styles.barMain)}
          onClick={onHold}
          title={mainTitle}
          disabled={state === "closed"}
        >
          <span className={styles.sessionName}>{session.name}</span>
          {state === "closed" ? (
            <span>ended {formatClock(session.end)}</span>
          ) : null}
          {lastCommand ? (
            <span className={styles.lastCommand}>
              $ {commandLabel(lastCommand.command)}
            </span>
          ) : null}
          {snippet ? <span className={styles.snippet}>· {snippet}</span> : null}
          {showPulse ? (
            <span className={styles.barMeta}>
              <span key={lastCommand.at} className={styles.newCommand}>
                new command
              </span>
            </span>
          ) : null}
        </button>
      </div>
      {hasBody ? (
        <TerminalBody
          id={id}
          session={session}
          height={bodyRows * lineHeight + kRowBodyPadding}
          onTogglePlay={onTogglePlay}
          onKey={onKey}
          onPlayer={onPlayer}
          scrollerRef={scrollerRef}
          pinned={pinned}
          onJumpToLatest={onJumpToLatest}
        />
      ) : null}
    </div>
  );
};

interface TerminalBodyProps {
  id: string;
  session: TerminalSession;
  height: number;
  onTogglePlay: () => void;
  onKey: (e: KeyboardEvent) => void;
  onPlayer: (player: AsciinemaPlayerHandle | null) => void;
  scrollerRef: (scroller: HTMLDivElement | null) => void;
  pinned: boolean;
  onJumpToLatest: () => void;
}

// The body scrolls (the view keeps it on the newest output unless the user
// scrolls up) and its text selects. A plain click toggles playback, as in the
// single-session player; Space is the keyboard equivalent, handled by the
// view.
const TerminalBody: FC<TerminalBodyProps> = ({
  id,
  session,
  height,
  onTogglePlay,
  onKey,
  onPlayer,
  scrollerRef,
  pinned,
  onJumpToLatest,
}) => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEventListener(bodyRef, "click", () => {
    // The end of a drag to select text also fires a click.
    if (window.getSelection()?.toString()) return;
    onTogglePlay();
  });
  // The player is display-only (the shared clock seeks it) but takes focus
  // when clicked, and its own keys would play it: the view handles keys from
  // inside the body before the player sees them.
  useEventListener(
    bodyRef,
    "keydown",
    (e) => {
      e.stopPropagation();
      onKey(e);
    },
    { capture: true }
  );
  return (
    <div className={styles.bodyFrame} style={{ height }}>
      <div
        ref={(element) => {
          bodyRef.current = element;
          scrollerRef(element);
        }}
        className={styles.body}
      >
        <div
          className={clsx("ap-default-term-ff", styles.playerCap)}
          data-terminal-clip
          style={cssVars({ "--terminal-cols": String(session.cols) })}
        >
          <AsciinemaPlayer
            id={id}
            cast={session.cast}
            rows={session.screenRows}
            cols={session.cols}
            fit="width"
            autoPlay={false}
            controls={false}
            idleTimeLimit={null}
            poster="npt:0"
            onPlayer={onPlayer}
          />
        </div>
      </div>
      {pinned ? (
        <button
          type="button"
          className={styles.latest}
          onClick={onJumpToLatest}
          title="Follow the newest output again"
        >
          ↓ Latest
        </button>
      ) : null}
    </div>
  );
};
