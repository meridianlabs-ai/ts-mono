import { create, DataSource, Marker } from "asciinema-player";

import "asciinema-player/dist/bundle/asciinema-player.css";

import { CSSProperties, FC, useEffect, useRef } from "react";

import { useLatestRef } from "../hooks/useLatestRef";

interface AsciinemaPlayerBaseProps {
  id?: string;
  rows?: number;
  cols?: number;
  fit?: "width" | "height" | "both" | "none" | false;
  style?: CSSProperties;
  speed?: number;
  autoPlay?: boolean;
  loop?: boolean;
  theme?: string;
  /** Gaps longer than this play at this length (default 2s); null plays
   *  every gap in full, even when the cast header sets `idle_time_limit`. */
  idleTimeLimit?: number | null;
  /** Where playback starts, in seconds on the idle-shortened timeline. */
  startAt?: number;
  /** Frame shown before playback, e.g. `npt:12.5` for the frame at 12.5s. */
  poster?: string;
  controls?: boolean | "auto";
  /** Scrubber ticks, at playback times (after idle shortening). */
  markers?: Marker[];
  /** Focus the player so its keyboard shortcuts work without a click. */
  autoFocus?: boolean;
  /** Clicking the terminal toggles play/pause (the player only reacts to
   *  clicks on its control bar by default). */
  clickToToggle?: boolean;
  /** Receives a handle for driving the player from outside (null when the
   *  player is disposed); a new handle follows each recreation. */
  onPlayer?: (player: AsciinemaPlayerHandle | null) => void;
  className?: string;
}

export interface AsciinemaPlayerHandle {
  /** Seek to seconds on the player's (idle-shortened) timeline; resolves once
   *  the frame there has drawn, and never rejects. */
  seek: (seconds: number) => Promise<void>;
  /** The player's root element. */
  element: HTMLElement;
}

// A session recorded as a `script -m advanced` input/output/timing triple.
interface AsciinemaTimingProps extends AsciinemaPlayerBaseProps {
  input: string;
  output: string;
  timing: string;
  cast?: never;
}

// A session recorded as a single asciicast v2 document.
interface AsciinemaCastProps extends AsciinemaPlayerBaseProps {
  cast: string;
  input?: never;
  output?: never;
  timing?: never;
}

type AsciinemaPlayerProps = AsciinemaTimingProps | AsciinemaCastProps;

const AsciinemaPlayerImpl: FC<AsciinemaPlayerProps> = ({
  id,
  rows,
  cols,
  input,
  output,
  timing,
  cast,
  fit,
  speed,
  autoPlay,
  loop,
  theme,
  idleTimeLimit = 2,
  startAt,
  poster,
  controls,
  markers,
  autoFocus,
  clickToToggle,
  onPlayer,
  style,
}) => {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  // Where the last player instance left off, so an option change (e.g.
  // speed) that recreates the player resumes the same recording at the same
  // point rather than starting over.
  const resumeRef = useRef<ResumePoint | null>(null);
  const onPlayerRef = useLatestRef(onPlayer);

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    const container = playerContainerRef.current;
    if (!container) return;

    // In-memory Responses, not Blob URLs the player would fetch: the
    // viewer's CSP allows no blob: connections. Fresh per load, since a
    // Response body reads once.
    const source: DataSource =
      cast !== undefined
        ? {
            data: () => new Response(cast),
            parser: "asciicast",
          }
        : {
            data: () => [
              new Response(timing),
              new Response(output),
              new Response(input),
            ],
            parser: "typescript",
          };

    const recording = { cast, input, output, timing };
    const resume =
      resumeRef.current && sameRecording(resumeRef.current.recording, recording)
        ? resumeRef.current
        : null;

    const player = create(source, container, {
      rows,
      cols,
      // A resumed player must not start itself during init: that would play
      // a paused session (and flash its opening frame) before the seek lands.
      autoPlay: resume ? false : autoPlay,
      loop,
      theme,
      speed,
      // The player reads the header's limit when the option is undefined.
      idleTimeLimit: idleTimeLimit ?? Number.POSITIVE_INFINITY,
      startAt,
      fit,
      poster,
      controls,
      markers,
    });

    let playing = false;
    player.addEventListener("playing", () => {
      playing = true;
    });
    player.addEventListener("pause", () => {
      playing = false;
    });
    player.addEventListener("ended", () => {
      playing = false;
    });

    if (resume) {
      // getCurrentTime() is on the idle-shortened timeline, which seek() takes
      // too.
      runPlayback(
        player
          .seek(resume.time)
          .then(() => (resume.playing ? player.play() : undefined))
      );
    } else if (autoPlay !== false) {
      // Plays unless autoPlay is explicitly false (callers like the human
      // baseline lightbox rely on mount-to-play).
      runPlayback(player.play());
    }

    if (autoFocus) {
      player.el.focus();
    }

    // The same callback hears about this player's disposal.
    const onPlayer = onPlayerRef.current;
    onPlayer?.({
      seek: (seconds) =>
        player.seek(seconds).then(
          () => undefined,
          () => undefined
        ),
      element: player.el,
    });

    const onClick = (e: MouseEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest(".ap-control-bar, .ap-overlay")
      ) {
        return;
      }
      // The end of a drag to select terminal text also fires a click.
      if (window.getSelection()?.toString()) return;
      runPlayback(playing ? player.pause() : player.play());
    };
    if (clickToToggle) {
      container.addEventListener("click", onClick);
    }

    return () => {
      container.removeEventListener("click", onClick);
      // Only a player that got somewhere leaves a resume point. Otherwise a
      // remount that never played (StrictMode's mount/unmount/mount) would
      // "resume" at 0, skipping the poster frame and autoPlay.
      const time = player.getCurrentTime();
      resumeRef.current =
        playing || time > 0 ? { recording, time, playing } : null;
      onPlayer?.(null);
      player.dispose();
    };
  }, [
    timing,
    output,
    input,
    cast,
    rows,
    cols,
    autoPlay,
    loop,
    theme,
    speed,
    idleTimeLimit,
    startAt,
    fit,
    poster,
    controls,
    markers,
    autoFocus,
    clickToToggle,
    onPlayerRef,
  ]);

  return (
    <div
      id={`asciinema-player-${id || "default"}`}
      ref={playerContainerRef}
      style={{ ...style }}
    />
  );
};

interface RecordingSource {
  cast?: string;
  input?: string;
  output?: string;
  timing?: string;
}

interface ResumePoint {
  recording: RecordingSource;
  time: number;
  playing: boolean;
}

const sameRecording = (a: RecordingSource, b: RecordingSource): boolean =>
  a.cast === b.cast &&
  a.input === b.input &&
  a.output === b.output &&
  a.timing === b.timing;

// Playback commands reject when the player is disposed mid-command (e.g. an
// option change recreates it); there's nothing to recover.
const runPlayback = (command: Promise<unknown>): void => {
  command.catch(() => undefined);
};

export default AsciinemaPlayerImpl;
export type { AsciinemaPlayerProps };
