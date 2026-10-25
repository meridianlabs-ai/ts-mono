import clsx from "clsx";
import { FC, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AsciinemaPlayer } from "@tsmono/react/components";
import { useEventListener } from "@tsmono/react/hooks";
import { Icon } from "@tsmono/react/icons";
import { formatTime, stripAnsi } from "@tsmono/util";

import styles from "./StoreTerminalSessions.module.css";

// Store keys bearing this prefix hold asciicast v2 documents written by
// terminal-recording tools (one key per named session).
const kAsciicastStorePrefix = "asciinema:";

// Pauses longer than this play as this long, so agent think time between
// commands doesn't stretch a session to many idle minutes.
const kIdleTimeLimit = 2;

// Think time at least this long is noted on the command marker that ends it.
const kIdleNoteMinGap = 30;

const kPlaybackSpeeds = [1, 2, 4];

export interface StoreCast {
  key: string;
  name: string;
  cast: string;
}

/** Collect the playable asciicast entries from a sample's store. */
export const storeCasts = (store: Record<string, unknown>): StoreCast[] =>
  Object.entries(store).flatMap(([key, value]) =>
    key.startsWith(kAsciicastStorePrefix) && typeof value === "string"
      ? [{ key, name: key.slice(kAsciicastStorePrefix.length), cast: value }]
      : []
  );

interface StoreTerminalSessionsProps {
  id: string;
  casts: StoreCast[];
}

/**
 * Shows each store asciicast as a paused preview tile; clicking a tile opens
 * it full-viewport, scaled to show the whole terminal, and plays it.
 */
export const StoreTerminalSessions: FC<StoreTerminalSessionsProps> = ({
  id,
  casts,
}) => {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Held here so the choice carries over as the user opens other sessions.
  const [speed, setSpeed] = useState(1);
  const displayCasts = casts.map((storeCast) => ({
    ...storeCast,
    cast: highlightCommandEchoes(storeCast.cast),
  }));
  const expanded = displayCasts.find(
    (storeCast) => storeCast.key === expandedKey
  );

  return (
    <>
      <div className={styles.tiles}>
        {displayCasts.map((storeCast) => (
          <TerminalTile
            key={storeCast.key}
            id={`${id}-${storeCast.name}`}
            buttonId={tilePlayButtonId(storeCast.key)}
            storeCast={storeCast}
            onOpen={() => setExpandedKey(storeCast.key)}
          />
        ))}
      </div>
      {expanded ? (
        <ExpandedTerminal
          id={`${id}-${expanded.name}-expanded`}
          storeCast={expanded}
          speed={speed}
          onSpeedChange={setSpeed}
          onClose={() => {
            setExpandedKey(null);
            document.getElementById(tilePlayButtonId(expanded.key))?.focus();
          }}
        />
      ) : null}
    </>
  );
};

// Lets closing the overlay return focus to the tile that opened it.
const tilePlayButtonId = (key: string) => `terminal-tile-play-${key}`;

interface TerminalTileProps {
  id: string;
  buttonId: string;
  storeCast: StoreCast;
  onOpen: () => void;
}

const TerminalTile: FC<TerminalTileProps> = ({
  id,
  buttonId,
  storeCast,
  onOpen,
}) => {
  const { rows, cols } = castGeometry(storeCast.cast);
  const duration = castDuration(storeCast.cast, kIdleTimeLimit);
  const recorded = castDuration(storeCast.cast);
  return (
    <div className={styles.tile}>
      <div className={styles.tileHeader}>
        <span className={clsx(styles.tileName, "text-size-small")}>
          {storeCast.name}
        </span>
        <span
          className="text-size-smallest text-style-secondary"
          title={
            recorded > duration
              ? `Plays in ${formatTime(duration)} (pauses over ${kIdleTimeLimit}s shortened); recorded over ${formatTime(recorded)}`
              : undefined
          }
        >
          {duration > 0 ? formatTime(duration) : ""}
        </span>
      </div>
      {/* Display-only: inert keeps the player's focusable terminal out of the
          tab order; the overlay button below takes clicks. */}
      <div className={styles.tilePreview} inert>
        <AsciinemaPlayer
          id={id}
          cast={storeCast.cast}
          rows={rows}
          cols={cols}
          fit="both"
          autoPlay={false}
          controls={false}
          idleTimeLimit={kIdleTimeLimit}
          poster={`npt:${duration}`}
          style={{ width: "100%", height: "100%" }}
        />
        <span className={styles.tilePlay}>
          <Icon name="play" />
        </span>
      </div>
      <button
        id={buttonId}
        type="button"
        className={styles.tileButton}
        onClick={onOpen}
        aria-label={`Play terminal ${storeCast.name}`}
        title={`Play ${storeCast.name}`}
      />
    </div>
  );
};

interface ExpandedTerminalProps {
  id: string;
  storeCast: StoreCast;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onClose: () => void;
}

const ExpandedTerminal: FC<ExpandedTerminalProps> = ({
  id,
  storeCast,
  speed,
  onSpeedChange,
  onClose,
}) => {
  const { rows, cols } = castGeometry(storeCast.cast);
  const duration = castDuration(storeCast.cast, kIdleTimeLimit);
  const recorded = castDuration(storeCast.cast);
  // Identity matters, not cost: the player is recreated when markers change.
  const markers = useMemo(
    () => castMarkers(storeCast.cast, kIdleTimeLimit, kIdleNoteMinGap),
    [storeCast.cast]
  );
  const overlayRef = useRef<HTMLDivElement>(null);

  // Window capture runs before any document listener, so stopping the event
  // here keeps Escape from also closing another surface (e.g. the find band).
  useEventListener(
    window,
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && overlayRef.current) {
        trapFocus(e, overlayRef.current);
      }
    },
    { capture: true }
  );

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Terminal ${storeCast.name}`}
    >
      <div className={styles.overlayHeader}>
        <span className={styles.overlayTitleGroup}>
          <span className={styles.overlayTitle}>{storeCast.name}</span>
          {recorded - duration >= 1 ? (
            <span className={clsx(styles.overlayNote, "text-size-small")}>
              Recorded over {formatTime(recorded)} ·{" "}
              <span className={styles.overlayNoteDetail}>
                pauses longer than {kIdleTimeLimit}s shortened
              </span>
            </span>
          ) : null}
        </span>
        <span className={styles.overlayControls}>
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
                  styles.headerButton,
                  speed === option && styles.headerButtonActive
                )}
                aria-pressed={speed === option}
                onClick={() => onSpeedChange(option)}
              >
                {option}×
              </button>
            ))}
          </span>
        </span>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.overlayBody}>
        <AsciinemaPlayer
          id={id}
          cast={storeCast.cast}
          rows={rows}
          cols={cols}
          fit="both"
          autoPlay
          autoFocus
          clickToToggle
          controls
          idleTimeLimit={kIdleTimeLimit}
          markers={markers}
          speed={speed}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>,
    document.body
  );
};

const kTabbableSelector =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Keeps Tab / Shift+Tab cycling within the overlay (it is aria-modal).
const trapFocus = (e: KeyboardEvent, container: HTMLElement): void => {
  const tabbables = Array.from(
    container.querySelectorAll<HTMLElement>(kTabbableSelector)
  );
  const first = tabbables[0];
  const last = tabbables.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  const inside = active instanceof Node && container.contains(active);
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
};

// Terminal geometry from the asciicast header (its first line), falling back
// to 80x24 when the header doesn't parse or doesn't carry it.
export const castGeometry = (cast: string): { rows: number; cols: number } => {
  let rows = 24;
  let cols = 80;
  const newline = cast.indexOf("\n");
  const headerLine = newline === -1 ? cast : cast.slice(0, newline);
  try {
    const header: unknown = JSON.parse(headerLine);
    if (typeof header === "object" && header !== null) {
      if ("height" in header && typeof header.height === "number") {
        rows = header.height;
      }
      if ("width" in header && typeof header.width === "number") {
        cols = header.width;
      }
    }
  } catch {
    // not an asciicast header: keep the defaults
  }
  return { rows, cols };
};

// Recording length in seconds (asciicast v2 event times are absolute). With
// `idleTimeLimit`, each gap between events is capped at it, as the player does
// on playback. Lines that aren't events are skipped.
export const castDuration = (cast: string, idleTimeLimit?: number): number => {
  let duration = 0;
  let previous = 0;
  for (const line of cast.split("\n").slice(1)) {
    const time = eventTime(line);
    if (time === undefined) continue;
    const gap = Math.max(0, time - previous);
    duration +=
      idleTimeLimit === undefined ? gap : Math.min(gap, idleTimeLimit);
    previous = time;
  }
  return duration;
};

// How far past the echoing output a command marker sits, so a pause there
// comes after that output has drawn.
const kCommandMarkerOffset = 0.01;

/**
 * The cast's own markers, placed on the playback timeline (every gap capped
 * at `idleTimeLimit`) for the player's `markers` option. When the cast has
 * command ("send …") markers, only those are kept, labeled by the command, so
 * the scrubber (and [ / ] jumps) step through commands, not screen reads. Each
 * sits just after the first output that follows it: the recorded marker is
 * stamped when the command is sent, before the terminal echoes it, so seeking
 * there would hide the command. Think time of at least `minGap` seconds before
 * a marker is noted on its label.
 */
export const castMarkers = (
  cast: string,
  idleTimeLimit: number,
  minGap: number
): [number, string][] => {
  const markers: [number, string][] = [];
  let pending: { time: number; label: string } | undefined;
  const flushPending = (time: number) => {
    if (pending) {
      markers.push([time, pending.label]);
      pending = undefined;
    }
  };

  const events = cast
    .split("\n")
    .slice(1)
    .flatMap((line) => parseEvent(line) ?? []);
  const commandsOnly = events.some(
    (event) => event.type === "m" && sentCommand(event.data) !== undefined
  );

  let playback = 0;
  let previous = 0;
  for (const event of events) {
    const gap = Math.max(0, event.time - previous);
    const idle = gap >= minGap ? `${formatTime(gap)} idle` : undefined;
    playback += Math.min(gap, idleTimeLimit);
    previous = event.time;

    if (event.type === "m") {
      const command = sentCommand(event.data);
      if (commandsOnly && command === undefined) continue;
      const label = command !== undefined ? commandLabel(command) : event.data;
      flushPending(pending?.time ?? playback);
      pending = {
        time: playback,
        label: idle ? `${label} (after ${idle})` : label,
      };
    } else if (event.type === "o") {
      flushPending(playback + kCommandMarkerOffset);
    }
  }
  flushPending(pending?.time ?? playback);
  return markers;
};

// Bold soft blue (#82AAFF, as 24-bit color so the player theme can't remap
// it), then back to normal weight and default color (not a full reset, which
// would drop any styling the output set around it).
const kInputStyleStart = "\x1b[1;38;2;130;170;255m";
const kInputStyleEnd = "\x1b[22;39m";

/**
 * Styles the terminal's echo of each sent command so input stands out from
 * output. The recording has no input events, but each "send …" marker is
 * followed by output whose first line echoes the command (plus `> `
 * continuation lines for a multi-line command). The echo is styled only when
 * it contains the start of the sent command, so output that doesn't echo it
 * (a key press like C-c, a redrawn screen) is left alone.
 */
export const highlightCommandEchoes = (cast: string): string => {
  const lines = cast.split("\n");
  let pendingCommand: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const event = parseEvent(line);
    if (event === undefined) continue;
    if (event.type === "m") {
      pendingCommand = sentCommand(event.data) ?? pendingCommand;
    } else if (event.type === "o" && pendingCommand !== undefined) {
      const styled = styleCommandEcho(event.data, pendingCommand);
      pendingCommand = undefined;
      if (styled !== event.data) {
        lines[i] = JSON.stringify([event.time, event.type, styled]);
      }
    }
  }
  return lines.join("\n");
};

const styleCommandEcho = (output: string, command: string): string => {
  // A chunk split mid-escape would get the style codes inside the sequence.
  if (endsInsideEscape(output)) return output;
  const probe = (command.split("\n")[0] ?? "").trim().slice(0, 20);
  const firstEnd = lineEnd(output, 0);
  if (!probe || !stripAnsi(output.slice(0, firstEnd)).includes(probe)) {
    return output;
  }
  let styled = styleInput(output.slice(0, firstEnd));
  let pos = firstEnd;
  if (command.trimEnd().includes("\n")) {
    while (output.startsWith("\r\n> ", pos)) {
      const end = lineEnd(output, pos + 2);
      styled += "\r\n" + styleInput(output.slice(pos + 2, end));
      pos = end;
    }
  }
  return styled + output.slice(pos);
};

const endsInsideEscape = (text: string): boolean => {
  const lastEscape = text.lastIndexOf("\x1b");
  return (
    lastEscape !== -1 && stripAnsi(text.slice(lastEscape)).startsWith("\x1b")
  );
};

const styleInput = (text: string): string =>
  `${kInputStyleStart}${text}${kInputStyleEnd}`;

const lineEnd = (text: string, from: number): number => {
  const end = text.indexOf("\r\n", from);
  return end === -1 ? text.length : end;
};

// The command text of a "send <terminal>: '<command>'" marker label, whose
// command is quoted and backslash-escaped Python-repr style; undefined for
// other markers (e.g. "open …", "read …").
const sentCommand = (label: string): string | undefined => {
  const match = /^send [^:]+: (['"])([\s\S]*)$/.exec(label);
  if (!match) return undefined;
  const [, quote = "", body = ""] = match;
  const quoted = body.endsWith(quote) ? body.slice(0, -quote.length) : body;
  return quoted.replace(/\\(.)/g, (_, c: string) =>
    c === "n" ? "\n" : c === "t" ? "\t" : c
  );
};

// A marker label for a command: its first line, with an ellipsis when more
// lines follow.
const commandLabel = (command: string): string => {
  const lines = command.trimEnd().split("\n");
  const first = (lines[0] ?? "").trim();
  return lines.length > 1 ? `${first} …` : first;
};

const eventTime = (line: string): number | undefined => parseEvent(line)?.time;

const parseEvent = (
  line: string
): { time: number; type: string; data: string } | undefined => {
  if (!line.trim()) return undefined;
  try {
    const event: unknown = JSON.parse(line);
    if (
      Array.isArray(event) &&
      typeof event[0] === "number" &&
      typeof event[1] === "string"
    ) {
      return {
        time: event[0],
        type: event[1],
        data: typeof event[2] === "string" ? event[2] : "",
      };
    }
  } catch {
    // not an event line
  }
  return undefined;
};
