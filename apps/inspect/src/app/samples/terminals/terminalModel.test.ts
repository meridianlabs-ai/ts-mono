import { describe, expect, it } from "vitest";

import { testSpanBeginEvent } from "@tsmono/inspect-common/testing";

import type { StoreCast } from "./asciicast";
import {
  adjacentCommand,
  agentTree,
  allocateRows,
  buildTerminalSample,
  focusAt,
  kMaxScreenRows,
  kPulseSeconds,
  kSharedIdleLimit,
  lastCommandAt,
  localTime,
  parseTerminalCasts,
  playbackToReal,
  publishBoundaries,
  publishWindow,
  realToPlayback,
  resultSnippet,
  rowStates,
  sessionPhase,
} from "./terminalModel";

const kOrigin = 1_792_950_894;

const makeCast = (
  session: string,
  startOffset: number,
  events: [number, "o" | "m", string][],
  header: Record<string, unknown> = {}
): StoreCast => ({
  key: `asciinema:terminal-${session}`,
  name: `terminal-${session}`,
  cast: [
    JSON.stringify({
      version: 2,
      width: 160,
      height: 40,
      timestamp: kOrigin + startOffset,
      ...header,
    }),
    ...events.map((event) => JSON.stringify(event)),
  ].join("\n"),
});

const send = (
  session: string,
  time: number,
  command: string
): [number, "o" | "m", string][] => [
  [time, "m", `send ${session}: '${command}\\n'`],
  [time + 0.5, "o", `$ ${command}\r\n`],
];

// main opens at 0 and runs to 100; tests opens at 10 and runs to 60.
const twoSessions = [
  makeCast("main", 0, [
    [0, "m", "open main"],
    ...send("main", 1, "git status"),
    ...send("main", 70, "npm run build"),
    [100, "o", "done\r\n"],
  ]),
  makeCast("tests", 10, [
    [0, "m", "open tests"],
    ...send("tests", 5, "npx vitest --watch"),
    [50, "o", "ok\r\n"],
  ]),
];

describe("buildTerminalSample", () => {
  it("places sessions on one real-time axis from their header timestamps", () => {
    const sample = buildTerminalSample(twoSessions);
    expect(sample.origin).toBe(kOrigin);
    expect(sample.duration).toBe(100);
    expect(
      sample.sessions.map(({ name, start, end }) => ({ name, start, end }))
    ).toEqual([
      { name: "main", start: 0, end: 100 },
      { name: "tests", start: 10, end: 60 },
    ]);
  });

  it("puts each command just after its echo, in real time", () => {
    const sample = buildTerminalSample(twoSessions);
    expect(
      sample.commands.map(({ command, sentAt, at }) => ({
        command,
        sentAt,
        at,
      }))
    ).toEqual([
      { command: "git status\n", sentAt: 1, at: 1.51 },
      { command: "npx vitest --watch\n", sentAt: 15, at: 15.51 },
      { command: "npm run build\n", sentAt: 70, at: 70.51 },
    ]);
  });

  it("shows a terminal opened beside a visible one at its first command", () => {
    const sample = buildTerminalSample(twoSessions);
    const [main, tests] = sample.sessions;
    if (!main || !tests) throw new Error("expected two sessions");
    // main opens into an empty view, so it shows at once.
    expect(sessionPhase(main, 0)).toBe("open");
    // tests opens at 10 beside main, and waits for its first echo at 15.51.
    expect(sessionPhase(tests, 12)).toBe("pending");
    expect(sessionPhase(tests, 15.6)).toBe("open");
  });

  it("gives each player a screen tall enough for all its output", () => {
    const sample = buildTerminalSample(twoSessions);
    expect(sample.sessions.map((session) => session.screenRows)).toEqual([
      43, 42,
    ]);
    const long = buildTerminalSample([
      makeCast("main", 0, [[1, "o", "line\r\n".repeat(5000)]]),
    ]);
    expect(long.sessions[0]?.screenRows).toBe(kMaxScreenRows);
  });

  it("builds the same sample from pre-parsed casts", () => {
    expect(buildTerminalSample(parseTerminalCasts(twoSessions))).toEqual(
      buildTerminalSample(twoSessions)
    );
  });
});

describe("shared clock", () => {
  it("shortens a gap only when every terminal is idle", () => {
    const sample = buildTerminalSample([
      makeCast("main", 0, [
        [0, "o", "a"],
        [100, "o", "b"],
      ]),
      makeCast("tests", 0, [
        [0, "o", "a"],
        [1, "o", "b"],
        [2, "o", "c"],
        [3, "o", "d"],
      ]),
    ]);
    // 0..3 busy, then 97 s with nothing: plays as 3 + 2.
    expect(sample.playbackDuration).toBe(3 + kSharedIdleLimit);
    expect(realToPlayback(sample, 2)).toBe(2);
    expect(realToPlayback(sample, 100)).toBe(5);
    expect(playbackToReal(sample, 4)).toBeCloseTo(51.5);
    expect(realToPlayback(sample, -5)).toBe(0);
    expect(playbackToReal(sample, 99)).toBe(100);
  });

  it("gives each player its raw local time, clamped to the recording", () => {
    const tests = buildTerminalSample(twoSessions).sessions[1];
    expect(tests).toBeDefined();
    if (!tests) return;
    expect(localTime(tests, 5)).toBe(0);
    expect(localTime(tests, 30)).toBe(20);
    expect(localTime(tests, 90)).toBe(50);
  });
});

describe("publishWindow", () => {
  const sample = buildTerminalSample(twoSessions);
  const agent = sample.agents[0];
  const p = (real: number) => realToPlayback(sample, real);
  const windowAt = (real: number, speed = 1) =>
    publishWindow(publishBoundaries(sample, agent!, speed), p(real));

  it("spans from a command's pulse end to the next session start", () => {
    // main's command at 1.51 pulses for kPulseSeconds; tests opens at 10.
    expect(windowAt(5)).toEqual({
      from: p(1.51) + kPulseSeconds,
      to: p(10),
    });
  });

  it("ends where a pending session first shows", () => {
    // tests is pending from 10 until its first command at 15.51.
    const window = windowAt(12);
    expect(window).toEqual({ from: p(10), to: p(15.51) });
    const tests = sample.sessions[1]!;
    expect(sessionPhase(tests, playbackToReal(sample, window.to))).toBe("open");
  });

  it("ends at a session's end", () => {
    // tests ends at 60; nothing else happens between its command and then.
    expect(windowAt(58)).toEqual({
      from: p(15.51) + kPulseSeconds,
      to: p(60),
    });
  });

  it("scales the pulse boundary with the speed", () => {
    const at = p(1.51);
    expect(publishBoundaries(sample, agent!, 1)).toContain(at + kPulseSeconds);
    expect(publishBoundaries(sample, agent!, 4)).toContain(
      at + kPulseSeconds * 4
    );
    expect(publishBoundaries(sample, agent!, 4)).not.toContain(
      at + kPulseSeconds
    );
  });

  it("starts at 0 and is open-ended past the end of playback", () => {
    expect(windowAt(0).from).toBe(0);
    expect(
      publishWindow(
        publishBoundaries(sample, agent!, 1),
        sample.playbackDuration
      )
    ).toEqual({
      from: sample.playbackDuration,
      to: Infinity,
    });
  });

  it("is the same window from either direction", () => {
    // A backwards scrub to 5 lands in the window a forward play would.
    const boundaries = publishBoundaries(sample, agent!, 1);
    expect(publishWindow(boundaries, p(5))).toEqual(windowAt(5));
    expect(publishWindow(boundaries, p(5)).from).toBeLessThanOrEqual(p(5));
    expect(publishWindow(boundaries, p(5)).to).toBeGreaterThan(p(5));
  });
});

describe("focus", () => {
  const sample = buildTerminalSample(twoSessions);
  const agent = sample.agents[0];
  if (!agent) throw new Error("expected one agent");

  it("is the earliest open session before any command", () => {
    expect(focusAt(agent, 0.5)).toBe("asciinema:terminal-main");
  });

  it("moves once the command's echo has drawn", () => {
    expect(focusAt(agent, 15.2)).toBe("asciinema:terminal-main");
    expect(focusAt(agent, 15.6)).toBe("asciinema:terminal-tests");
  });

  it("falls back to an open session when the focused one closes", () => {
    expect(focusAt(agent, 61)).toBe("asciinema:terminal-main");
    expect(focusAt(agent, 200)).toBeUndefined();
  });

  it("segments the timeline by focus", () => {
    expect(agent.focusSegments).toEqual([
      { sessionKey: "asciinema:terminal-main", start: 0, end: 15.51 },
      { sessionKey: "asciinema:terminal-tests", start: 15.51, end: 60 },
      { sessionKey: "asciinema:terminal-main", start: 60, end: 100 },
    ]);
  });

  it("finds a session's last command at a time", () => {
    expect(
      lastCommandAt(sample.commands, "asciinema:terminal-main", 69)?.command
    ).toBe("git status\n");
    expect(
      lastCommandAt(sample.commands, "asciinema:terminal-tests", 10)
    ).toBeUndefined();
  });
});

describe("adjacentCommand", () => {
  const { commands } = buildTerminalSample(twoSessions);

  it("steps to the next or previous command across sessions", () => {
    expect(adjacentCommand(commands, 10, 1)?.command).toBe(
      "npx vitest --watch\n"
    );
    expect(adjacentCommand(commands, 10, -1)?.command).toBe("git status\n");
  });

  it("steps past a command the playhead sits on", () => {
    expect(adjacentCommand(commands, 15.51, 1)?.command).toBe(
      "npm run build\n"
    );
    expect(adjacentCommand(commands, 15.51, -1)?.command).toBe("git status\n");
    expect(adjacentCommand(commands, 70.51, 1)).toBeUndefined();
  });
});

describe("resultSnippet", () => {
  it("orders output by time, so a late-written chunk isn't shown early", () => {
    const sample = buildTerminalSample([
      makeCast("main", 0, [
        [0, "o", "a\r\n"],
        [5, "o", "late\r\n"],
        [2, "o", "b\r\n"],
      ]),
    ]);
    const main = sample.sessions[0]!;
    expect(resultSnippet(main, 2.5)).toBe("b");
    expect(resultSnippet(main, 1)).toBe("a");
    expect(resultSnippet(main, 6)).toBe("late");
  });

  const { sessions } = buildTerminalSample([
    makeCast("build", 0, [
      [1, "m", "send build: 'npm run build\\n'"],
      [1.5, "o", "$ npm run build\r\n\x1b[32m✓ built in 14.5s\x1b[0m\r\n"],
      [1.6, "o", "$ "],
    ]),
  ]);
  const build = sessions[0];
  if (!build) throw new Error("expected one session");

  it("is the last output line, skipping prompts and echoes", () => {
    expect(resultSnippet(build, 2)).toBe("✓ built in 14.5s");
  });

  it("only counts output shown by the time", () => {
    expect(resultSnippet(build, 1.2)).toBeUndefined();
  });
});

describe("rowStates", () => {
  const { sessions } = buildTerminalSample([
    ...twoSessions,
    makeCast("build", 80, [[1, "o", "x"]]),
  ]);

  it("classifies by phase, focus and the user's folds", () => {
    const states = (real: number, focus?: string, folded: string[] = []) =>
      Object.fromEntries(rowStates(sessions, real, focus, new Set(folded)));
    expect(states(20, "asciinema:terminal-tests")).toEqual({
      "asciinema:terminal-main": "open",
      "asciinema:terminal-tests": "focused",
      "asciinema:terminal-build": "pending",
    });
    expect(
      states(80.5, "asciinema:terminal-main", [
        "asciinema:terminal-main",
        "asciinema:terminal-build",
      ])
    ).toEqual({
      "asciinema:terminal-main": "focused",
      "asciinema:terminal-tests": "closed",
      "asciinema:terminal-build": "folded",
    });
  });
});

describe("allocateRows", () => {
  // Brief §4.4's worked case: fix-failing-tests at 40:00 has one closed, one
  // focused and two open sessions. Stage heights are the viewport less the
  // 46 px header, 156 px controls and 14 px stage padding. Our bars (26 px)
  // are shorter than the brief's, so some cases give the focus a row more
  // than its numbers.
  const rows = [
    { key: "main", state: "closed" as const },
    { key: "server", state: "focused" as const, lastCommandAt: 2390 },
    { key: "tests", state: "open" as const, lastCommandAt: 2300 },
    { key: "build", state: "open" as const, lastCommandAt: 2100 },
  ];
  const allocate = (
    stageHeight: number,
    lineHeight: number,
    overrides: Partial<Parameters<typeof allocateRows>[0]> = {}
  ) =>
    allocateRows({
      rows,
      stageHeight,
      foldGain: 104,
      lineHeight,
      timeline: "auto",
      ...overrides,
    });

  it("gives the focus 20 rows at 1440×900", () => {
    const result = allocate(900 - 216, 19.5);
    expect(Object.fromEntries(result.bodyRows)).toEqual({
      main: 0,
      server: 20,
      tests: 3,
      build: 3,
    });
    expect(result.timelineFolded).toBe(false);
    expect(result.scrolls).toBe(false);
  });

  it("folds the timeline at 1440×700, leaving the focus 15 rows", () => {
    const result = allocate(700 - 216, 19.5);
    expect(result.timelineFolded).toBe(true);
    expect(result.bodyRows.get("server")).toBe(15);
  });

  it("gives the focus 32 rows at 2560×1440", () => {
    expect(allocate(1440 - 216, 27).bodyRows.get("server")).toBe(32);
  });

  it("keeps the timeline open when the user pinned it", () => {
    const result = allocate(700 - 216, 19.5, { timeline: "unfolded" });
    expect(result.timelineFolded).toBe(false);
    expect(result.bodyRows.get("server")).toBe(9);
    expect(result.scrolls).toBe(false);
  });

  it("holds the focus at 8 rows and scrolls when the floors don't fit", () => {
    const result = allocate(300, 19.5);
    expect(result.bodyRows.get("server")).toBe(8);
    expect(result.bodyRows.get("tests")).toBe(3);
    expect(result.scrolls).toBe(true);
  });

  it("caps the focus at 40 and gives extra rows to recent tails first", () => {
    const result = allocate(2200, 19.5);
    expect(result.bodyRows.get("server")).toBe(40);
    expect(result.bodyRows.get("tests")).toBe(40);
    expect(result.bodyRows.get("build")).toBeGreaterThan(3);
    expect(result.bodyRows.get("build")).toBeLessThan(40);
  });

  it("releases a folded tail's rows to the focus", () => {
    const result = allocateRows({
      rows: [
        { key: "server", state: "focused" },
        { key: "tests", state: "folded" },
      ],
      stageHeight: 684,
      foldGain: 104,
      lineHeight: 19.5,
      timeline: "auto",
    });
    expect(Object.fromEntries(result.bodyRows)).toEqual({
      server: 31,
      tests: 0,
    });
  });
});

describe("agentTree", () => {
  const span = (id: string, parent_id?: string, type = "agent") =>
    testSpanBeginEvent({ id, parent_id, type, name: id });

  it("orders agents depth-first in spawn order, counting only terminal agents", () => {
    const events = [
      span("solvers", undefined, "solvers"),
      span("main", "solvers"),
      span("planner", "main"),
      span("runner", "planner"),
      span("reviewer", "main"),
    ];
    expect(agentTree(["reviewer", "runner", "main"], events)).toEqual([
      { id: "main", depth: 0 },
      { id: "runner", depth: 1 },
      { id: "reviewer", depth: 1 },
    ]);
  });

  it("keeps agents without a span, and a parent cycle, as roots", () => {
    const events = [span("a", "b"), span("b", "a")];
    expect(agentTree(["", "a", "b"], events)).toEqual([
      { id: "", depth: 0 },
      { id: "a", depth: 0 },
      { id: "b", depth: 0 },
    ]);
  });
});
