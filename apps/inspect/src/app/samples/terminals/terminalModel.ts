import type { Event } from "@tsmono/inspect-common/types";
import { stripAnsi } from "@tsmono/util";

import {
  castEvents,
  castHeader,
  highlightCommandEchoes,
  kCommandMarkerOffset,
  terminalMarker,
  type StoreCast,
  type TerminalMarker,
} from "./asciicast";

// On the shared clock a gap is shortened to this only while every terminal is
// idle (single-session playback shortens each session's own gaps).
export const kSharedIdleLimit = 2;
// How long (wall seconds) a new command pulses its row's bar.
export const kPulseSeconds = 0.6;

export const kPlaybackSpeeds = [1, 2, 4];

// The player draws only its screen (no scrollback), so a session plays on a
// screen tall enough for all its output, keeping the history scrollable. The
// cap keeps the player's canvas (24px a row) within browser size limits.
export const kMaxScreenRows = 1000;

export interface TerminalSession {
  /** Store key; the session's identity. */
  key: string;
  /** The terminal tool's session name. */
  name: string;
  /** The cast with command echoes styled, as the players show it. */
  cast: string;
  rows: number;
  cols: number;
  /** The player's screen height: the recorded rows plus a row per output
   *  line, up to kMaxScreenRows. A clear still wipes it. */
  screenRows: number;
  /** Real seconds from the sample's terminal origin. */
  start: number;
  end: number;
  /** When the row appears (real seconds). A terminal opening beside visible
   *  ones waits for its first command's echo, so it appears once focus moves
   *  to it rather than at a prompt-only height that grows a moment later; one
   *  opening into an empty view (or never sent a command) shows at its
   *  start. */
  shownFrom: number;
  agentId: string;
  /** Output events, in local (session) seconds. */
  output: { time: number; data: string }[];
}

export interface TerminalCommand {
  sessionKey: string;
  command: string;
  /** When the command was sent (real seconds). */
  sentAt: number;
  /** When its echo has drawn (real seconds): focus moves here, and seeking
   *  here shows the command. */
  at: number;
}

export interface FocusSegment {
  sessionKey: string;
  start: number;
  end: number;
}

export interface TerminalAgent {
  /** The `ir_agent_span_id` of its sessions; "" for casts without one. */
  id: string;
  name: string;
  /** Spawn depth among the sample's terminal agents (0 for a root). */
  depth: number;
  sessions: TerminalSession[];
  commands: TerminalCommand[];
  focusSegments: FocusSegment[];
}

export interface TerminalSample {
  /** Epoch seconds of the earliest session start (0 without timestamps). */
  origin: number;
  /** Real seconds from origin to the last session end. */
  duration: number;
  /** [real, playback] pairs of the shared clock's piecewise-linear map. */
  knots: [number, number][];
  playbackDuration: number;
  sessions: TerminalSession[];
  commands: TerminalCommand[];
  agents: TerminalAgent[];
}

/**
 * Places the store casts on one real-time axis. Sessions are grouped into
 * agents by their `ir_agent_span_id` header field; casts without it form one
 * group.
 */
export const buildTerminalSample = (
  casts: StoreCast[] | TerminalCasts,
  events: Event[] = []
): TerminalSample => {
  const parsed = Array.isArray(casts)
    ? parseTerminalCasts(casts).casts
    : casts.casts;

  const timestamps = parsed.flatMap(({ header }) =>
    header.timestamp !== undefined ? [header.timestamp] : []
  );
  const origin = timestamps.length > 0 ? Math.min(...timestamps) : 0;

  const sessions = parsed
    .map(
      ({ storeCast, header, highlighted, events: castEventList, markers }) => {
        const start =
          header.timestamp !== undefined ? header.timestamp - origin : 0;
        const length = castEventList.at(-1)?.time ?? 0;
        const outputLines = castEventList.reduce(
          (count, event) =>
            event.type === "o" ? count + countNewlines(event.data) : count,
          0
        );
        const session: TerminalSession = {
          key: storeCast.key,
          name: header.session ?? markers[0]?.marker.session ?? storeCast.name,
          cast: highlighted,
          rows: header.rows,
          cols: header.cols,
          screenRows: Math.min(kMaxScreenRows, header.rows + outputLines),
          start,
          end: start + length,
          shownFrom: start,
          agentId: header.agentSpanId ?? "",
          // Sorted so outputIndexAt can bisect; recorders write in order,
          // but nothing upstream checks.
          output: castEventList
            .filter((event) => event.type === "o")
            .map(({ time, data }) => ({ time, data }))
            .sort((a, b) => a.time - b.time),
        };
        return { session, header, events: castEventList, markers };
      }
    )
    .sort(
      (a, b) =>
        a.session.start - b.session.start ||
        a.session.key.localeCompare(b.session.key)
    );

  const commands: TerminalCommand[] = [];
  for (const { session, events: castEventList, markers } of sessions) {
    for (const { event, marker } of markers) {
      const sentAt = session.start + event.time;
      if (marker.action === "send") {
        const echo = castEventList.find(
          (candidate) => candidate.type === "o" && candidate.time >= event.time
        );
        const nextMarker = castEventList.find(
          (candidate) => candidate.type === "m" && candidate.time > event.time
        );
        const echoed =
          echo && (!nextMarker || echo.time <= nextMarker.time)
            ? echo.time + kCommandMarkerOffset
            : event.time;
        commands.push({
          sessionKey: session.key,
          command: marker.command ?? "",
          sentAt,
          at: session.start + echoed,
        });
      }
    }
  }
  commands.sort((a, b) => a.at - b.at);

  const sessionList = shownFrom(
    sessions.map(({ session }) => session),
    commands
  );
  const duration = Math.max(0, ...sessionList.map((session) => session.end));
  const knots = buildKnots(sessionList, commands, duration);

  const agentHeaders = new Map<string, string>();
  for (const { session, header } of sessions) {
    if (!agentHeaders.has(session.agentId) || header.agentName) {
      agentHeaders.set(
        session.agentId,
        header.agentName ?? agentHeaders.get(session.agentId) ?? "agent"
      );
    }
  }
  const agents = agentTree([...agentHeaders.keys()], events).map(
    ({ id, depth }) => {
      const agentSessions = sessionList.filter(
        (session) => session.agentId === id
      );
      const keys = new Set(agentSessions.map((session) => session.key));
      const agentCommands = commands.filter((command) =>
        keys.has(command.sessionKey)
      );
      return {
        id,
        name: agentHeaders.get(id) ?? "agent",
        depth,
        sessions: agentSessions,
        commands: agentCommands,
        focusSegments: focusSegments(agentSessions, agentCommands),
      };
    }
  );

  return {
    origin,
    duration,
    knots,
    playbackDuration: knots.at(-1)?.[1] ?? 0,
    sessions: sessionList,
    commands,
    agents,
  };
};

/** The sample's casts parsed and highlighted once. This is the expensive part
 *  of building the sample (multi-MB strings), so a host that rebuilds the
 *  sample as events arrive can keep it across rebuilds. */
export interface TerminalCasts {
  casts: ParsedCast[];
}

interface ParsedCast {
  storeCast: StoreCast;
  header: ReturnType<typeof castHeader>;
  highlighted: string;
  events: ReturnType<typeof castEvents>;
  markers: {
    event: ReturnType<typeof castEvents>[number];
    marker: TerminalMarker;
  }[];
}

export const parseTerminalCasts = (casts: StoreCast[]): TerminalCasts => ({
  casts: casts.map((storeCast) => {
    const header = castHeader(storeCast.cast);
    const castEventList = castEvents(storeCast.cast);
    const markers = castEventList.flatMap((event) => {
      const marker =
        event.type === "m" ? terminalMarker(event.data) : undefined;
      return marker ? [{ event, marker }] : [];
    });
    return {
      storeCast,
      header,
      highlighted: highlightCommandEchoes(storeCast.cast),
      events: castEventList,
      markers,
    };
  }),
});

const countNewlines = (data: string): number => {
  let count = 0;
  for (let i = data.indexOf("\n"); i !== -1; i = data.indexOf("\n", i + 1)) {
    count++;
  }
  return count;
};

// Sessions are in start order, so each one's visible predecessors are
// settled before it.
const shownFrom = (
  sessions: TerminalSession[],
  commands: TerminalCommand[]
): TerminalSession[] => {
  const shown: TerminalSession[] = [];
  for (const session of sessions) {
    const besideVisible = shown.some(
      (other) =>
        other.shownFrom <= session.start &&
        other.end >= session.start &&
        other.agentId === session.agentId
    );
    const firstCommand = commands.find(
      (command) => command.sessionKey === session.key
    );
    shown.push({
      ...session,
      shownFrom:
        besideVisible && firstCommand
          ? Math.min(firstCommand.at, session.end)
          : session.start,
    });
  }
  return shown;
};

// The shared clock: over the union of every session's event times, a gap
// plays at full length unless it exceeds the idle limit, which only happens
// when no terminal does anything for that long.
const buildKnots = (
  sessions: TerminalSession[],
  commands: TerminalCommand[],
  duration: number
): [number, number][] => {
  const times = new Set<number>([0, duration]);
  for (const session of sessions) {
    times.add(session.start);
    times.add(session.end);
    for (const { time } of session.output) {
      times.add(session.start + time);
    }
  }
  for (const command of commands) {
    times.add(command.sentAt);
    times.add(command.at);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const knots: [number, number][] = [];
  let playback = 0;
  let previous: number | undefined;
  for (const time of sorted) {
    if (previous !== undefined) {
      playback += Math.min(time - previous, kSharedIdleLimit);
    }
    knots.push([time, playback]);
    previous = time;
  }
  return knots;
};

/** Playback seconds on the shared clock for a real time. */
export const realToPlayback = (sample: TerminalSample, real: number): number =>
  interpolate(sample.knots, real, 0, 1);

/** Real seconds for a playback time on the shared clock. */
export const playbackToReal = (
  sample: TerminalSample,
  playback: number
): number => interpolate(sample.knots, playback, 1, 0);

/**
 * The playback times at which something the view derives from the clock
 * changes: each command (and the end of its pulse), each session's start,
 * first showing and end, and the ends of playback. Sorted, without
 * duplicates. Between two adjacent boundaries the view renders the same
 * thing, apart from the readout, playhead and folded snippets, which follow
 * the clock themselves.
 */
export const publishBoundaries = (
  sample: TerminalSample,
  agent: TerminalAgent,
  speed: number
): number[] => {
  const times = new Set<number>([0, sample.playbackDuration]);
  for (const command of agent.commands) {
    const at = realToPlayback(sample, command.at);
    times.add(at);
    times.add(at + kPulseSeconds * speed);
  }
  for (const session of agent.sessions) {
    for (const real of [session.start, session.shownFrom, session.end]) {
      times.add(realToPlayback(sample, real));
    }
  }
  return [...times].sort((a, b) => a - b);
};

/** The interval `from <= playback < to` between adjacent boundaries; past
 *  the last one, `to` is Infinity. */
export const publishWindow = (
  boundaries: number[],
  playback: number
): { from: number; to: number } => {
  let from = 0;
  for (const boundary of boundaries) {
    if (boundary > playback) return { from, to: boundary };
    from = boundary;
  }
  return { from, to: Infinity };
};

const interpolate = (
  knots: [number, number][],
  x: number,
  from: 0 | 1,
  to: 0 | 1
): number => {
  const first = knots[0];
  const last = knots.at(-1);
  if (!first || !last) return 0;
  if (x <= first[from]) return first[to];
  if (x >= last[from]) return last[to];
  let lo = 0;
  let hi = knots.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if ((knots[mid]?.[from] ?? 0) <= x) lo = mid;
    else hi = mid;
  }
  const [a, b] = [knots[lo], knots[hi]];
  if (!a || !b || b[from] === a[from]) return a?.[to] ?? 0;
  return a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
};

export type SessionPhase = "pending" | "open" | "closed";

export const sessionPhase = (
  session: TerminalSession,
  real: number
): SessionPhase =>
  real < session.shownFrom ? "pending" : real > session.end ? "closed" : "open";

/** The player position for a real time: seconds into the session's own
 *  recording (the players don't shorten idle time). */
export const localTime = (session: TerminalSession, real: number): number =>
  Math.min(Math.max(real - session.start, 0), session.end - session.start);

/**
 * The session the agent is working in at a real time: that of its most recent
 * command whose session is still open (commands move focus once their echo
 * has drawn), else its earliest open session; undefined when none is open.
 */
export const focusAt = (
  agent: Pick<TerminalAgent, "sessions" | "commands">,
  real: number
): string | undefined => {
  const open = new Set(
    agent.sessions
      .filter((session) => sessionPhase(session, real) === "open")
      .map((session) => session.key)
  );
  for (let i = agent.commands.length - 1; i >= 0; i--) {
    const command = agent.commands[i];
    if (command && command.at <= real && open.has(command.sessionKey)) {
      return command.sessionKey;
    }
  }
  return agent.sessions.find((session) => open.has(session.key))?.key;
};

// Focus changes only at a command or when a session opens or closes, so the
// segments are focusAt evaluated between those boundaries.
const focusSegments = (
  sessions: TerminalSession[],
  commands: TerminalCommand[]
): FocusSegment[] => {
  const boundaries = [
    ...new Set([
      ...commands.map((command) => command.at),
      ...sessions.flatMap((session) => [session.shownFrom, session.end]),
    ]),
  ].sort((a, b) => a - b);
  const segments: FocusSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i] ?? 0;
    const end = boundaries[i + 1] ?? start;
    if (end <= start) continue;
    const sessionKey = focusAt({ sessions, commands }, (start + end) / 2);
    const previous = segments.at(-1);
    if (sessionKey === undefined) continue;
    if (previous?.sessionKey === sessionKey && previous.end === start) {
      previous.end = end;
    } else {
      segments.push({ sessionKey, start, end });
    }
  }
  return segments;
};

/** The most recent command sent to a session at or before a real time. */
export const lastCommandAt = (
  commands: TerminalCommand[],
  sessionKey: string,
  real: number
): TerminalCommand | undefined => {
  let last: TerminalCommand | undefined;
  for (const command of commands) {
    if (command.at > real) break;
    if (command.sessionKey === sessionKey) last = command;
  }
  return last;
};

/** The command before or after a real time, across every given session. */
export const adjacentCommand = (
  commands: TerminalCommand[],
  real: number,
  step: 1 | -1
): TerminalCommand | undefined => {
  // A seek lands exactly on a command; skip past it rather than returning it.
  const epsilon = 0.05;
  if (step === 1)
    return commands.find((command) => command.at > real + epsilon);
  return commands.findLast((command) => command.at < real - epsilon);
};

// A shell prompt alone, or the echo of a command, says nothing about results.
const kPromptOnly = /^[$#>%]\s*$/;
const kEchoLine = /^\$ /;

/** Index of the session's last output chunk at or before a real time (-1
 *  before any). Bisects: a folded row's snippet asks every frame. */
export const outputIndexAt = (
  session: TerminalSession,
  real: number
): number => {
  const local = real - session.start;
  const { output } = session;
  let lo = 0;
  let hi = output.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((output[mid]?.time ?? Infinity) <= local) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
};

/**
 * The last non-empty output line a session had shown by a real time, ANSI
 * stripped, skipping bare prompts and command echoes: what a folded or closed
 * bar shows as its result.
 */
export const resultSnippet = (
  session: TerminalSession,
  real: number
): string | undefined => resultSnippetAt(session, outputIndexAt(session, real));

/** resultSnippet from an output index (outputIndexAt), so a subscriber that
 *  selects the index rescans only when it changes. */
export const resultSnippetAt = (
  session: TerminalSession,
  index: number
): string | undefined => {
  for (let i = index; i >= 0; i--) {
    const chunk = session.output[i];
    if (!chunk) continue;
    const lines = stripAnsi(chunk.data).split(/\r?\n|\r/);
    for (let j = lines.length - 1; j >= 0; j--) {
      const line = (lines[j] ?? "").trim();
      if (line && !kPromptOnly.test(line) && !kEchoLine.test(line)) {
        return line;
      }
    }
  }
  return undefined;
};

/**
 * Orders the terminal agents (by their agent span ids) as a spawn tree:
 * depth-first in span start order, each with its depth among these agents
 * (an intermediate agent without terminals doesn't count). Agents whose span
 * isn't in the events keep their order, as roots.
 */
export const agentTree = (
  agentIds: string[],
  events: Event[]
): { id: string; depth: number }[] => {
  const spanParent = new Map<string, string | undefined>();
  const spanOrder = new Map<string, number>();
  for (const event of events) {
    if (event.event === "span_begin") {
      spanParent.set(event.id, event.parent_id ?? undefined);
      spanOrder.set(event.id, spanOrder.size);
    }
  }
  const ids = new Set(agentIds);
  const parentAgent = (id: string): string | undefined => {
    const seen = new Set([id]);
    let parent = spanParent.get(id);
    while (parent !== undefined && !ids.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = spanParent.get(parent);
    }
    return parent !== undefined && ids.has(parent) ? parent : undefined;
  };
  const order = (id: string) =>
    spanOrder.get(id) ?? spanOrder.size + agentIds.indexOf(id);
  const children = new Map<string | undefined, string[]>();
  for (const id of [...agentIds].sort((a, b) => order(a) - order(b))) {
    const parent = parentAgent(id);
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const result: { id: string; depth: number }[] = [];
  const visit = (parent: string | undefined, depth: number) => {
    for (const id of children.get(parent) ?? []) {
      result.push({ id, depth });
      visit(id, depth + 1);
    }
  };
  visit(undefined, 0);
  // A parent cycle leaves agents unreached; they still get a row.
  const placed = new Set(result.map(({ id }) => id));
  for (const id of agentIds) {
    if (!placed.has(id)) result.push({ id, depth: 0 });
  }
  return result;
};

export type RowState = "focused" | "open" | "folded" | "closed" | "pending";

/** Each session's row state at a real time (brief §4.3). A held or focused
 *  session counts as focused even when the user folded it. */
export const rowStates = (
  sessions: TerminalSession[],
  real: number,
  focusKey: string | undefined,
  folded: ReadonlySet<string>
): Map<string, RowState> =>
  new Map(
    sessions.map((session) => {
      const phase = sessionPhase(session, real);
      const state: RowState =
        phase !== "open"
          ? phase
          : session.key === focusKey
            ? "focused"
            : folded.has(session.key)
              ? "folded"
              : "open";
      return [session.key, state];
    })
  );

export const kRowBarHeight = 26;
export const kRowGap = 10;
export const kRowBodyPadding = 14;
export const kTailRows = 3;
export const kMaxRows = 40;
const kFocusFoldThreshold = 16;
const kFocusFloor = 8;

export type TimelineFold = "auto" | "folded" | "unfolded";

export interface RowAllocation {
  /** Terminal rows shown in each row's body (0: bar only). */
  bodyRows: Map<string, number>;
  timelineFolded: boolean;
  /** The floors don't fit: the stage scrolls. */
  scrolls: boolean;
}

/**
 * Brief §4.4: closed rows get a bar, open tails 3 rows, the focused row the
 * rest up to 40; a focus under 16 rows folds the timeline (unless the user
 * pinned it open), and one under 8 holds at 8 and lets the stage scroll;
 * rows past the focus's 40 go to the tails, most recently commanded first.
 */
export const allocateRows = (input: {
  rows: { key: string; state: RowState; lastCommandAt?: number }[];
  /** Stage height with the timeline unfolded (padding excluded). */
  stageHeight: number;
  /** Height the stage gains when the timeline folds. */
  foldGain: number;
  lineHeight: number;
  timeline: TimelineFold;
}): RowAllocation => {
  const shown = input.rows.filter((row) => row.state !== "pending");
  const focused = shown.find((row) => row.state === "focused");
  const tails = shown.filter((row) => row.state === "open");
  const bodies = (focused ? 1 : 0) + tails.length;
  const fixed =
    shown.length * kRowBarHeight +
    Math.max(0, shown.length - 1) * kRowGap +
    bodies * kRowBodyPadding;
  const freeRows = (folded: boolean) =>
    Math.floor(
      (input.stageHeight + (folded ? input.foldGain : 0) - fixed) /
        input.lineHeight
    );

  let timelineFolded = input.timeline === "folded";
  let available = freeRows(timelineFolded);
  if (
    focused &&
    input.timeline === "auto" &&
    available - tails.length * kTailRows < kFocusFoldThreshold
  ) {
    timelineFolded = true;
    available = freeRows(true);
  }

  const bodyRows = new Map<string, number>(
    input.rows.map((row) => [row.key, 0])
  );
  for (const tail of tails) bodyRows.set(tail.key, kTailRows);
  let scrolls = false;
  if (focused) {
    let rows = available - tails.length * kTailRows;
    if (rows < kFocusFloor) {
      scrolls = true;
      rows = kFocusFloor;
    }
    const focusRows = Math.min(rows, kMaxRows);
    bodyRows.set(focused.key, focusRows);
    let extra = rows - focusRows;
    const byRecency = [...tails].sort(
      (a, b) => (b.lastCommandAt ?? -1) - (a.lastCommandAt ?? -1)
    );
    for (const tail of byRecency) {
      if (extra <= 0) break;
      const grant = Math.min(extra, kMaxRows - kTailRows);
      bodyRows.set(tail.key, kTailRows + grant);
      extra -= grant;
    }
  } else if (available < tails.length * kTailRows) {
    scrolls = tails.length > 0;
  }
  return { bodyRows, timelineFolded, scrolls };
};
