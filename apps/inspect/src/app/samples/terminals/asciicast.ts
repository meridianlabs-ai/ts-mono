import { stripAnsi } from "@tsmono/util";

// Store keys bearing this prefix hold asciicast v2 documents written by
// terminal-recording tools (one key per named session).
const kAsciicastStorePrefix = "asciinema:";

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

export interface CastHeader {
  rows: number;
  cols: number;
  /** Recording start, in epoch seconds. */
  timestamp?: number;
  /** The `ir_*` fields inspect_ranges adds: the terminal tool's session name
   *  and the agent span that opened it. */
  session?: string;
  agentSpanId?: string;
  agentName?: string;
}

/**
 * The asciicast header (the cast's first line). Geometry falls back to 80x24
 * when the header doesn't parse or doesn't carry it; other fields are left
 * out when absent or mistyped.
 */
export const castHeader = (cast: string): CastHeader => {
  const result: CastHeader = { rows: 24, cols: 80 };
  const newline = cast.indexOf("\n");
  const headerLine = newline === -1 ? cast : cast.slice(0, newline);
  let header: unknown;
  try {
    header = JSON.parse(headerLine);
  } catch {
    return result;
  }
  if (typeof header !== "object" || header === null) return result;
  const fields = new Map<string, unknown>(Object.entries(header));
  const number = (name: string) => {
    const value = fields.get(name);
    return typeof value === "number" ? value : undefined;
  };
  const text = (name: string) => {
    const value = fields.get(name);
    return typeof value === "string" && value ? value : undefined;
  };
  result.rows = number("height") ?? result.rows;
  result.cols = number("width") ?? result.cols;
  const timestamp = number("timestamp");
  const session = text("ir_session");
  const agentSpanId = text("ir_agent_span_id");
  const agentName = text("ir_agent");
  if (timestamp !== undefined) result.timestamp = timestamp;
  if (session !== undefined) result.session = session;
  if (agentSpanId !== undefined) result.agentSpanId = agentSpanId;
  if (agentName !== undefined) result.agentName = agentName;
  return result;
};

export interface CastEvent {
  time: number;
  type: string;
  data: string;
}

/** The cast's events (lines after the header); lines that aren't events are
 *  skipped. */
export const castEvents = (cast: string): CastEvent[] =>
  cast
    .split("\n")
    .slice(1)
    .flatMap((line) => parseEvent(line) ?? []);

// How far past the echoing output a command marker sits, so a pause there
// comes after that output has drawn.
export const kCommandMarkerOffset = 0.01;

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

export interface TerminalMarker {
  action: "open" | "send" | "read";
  session: string;
  /** The sent keystrokes, for `send`. */
  command?: string;
}

/**
 * The terminal tool call a marker label records: `open <session>`,
 * `read <session>`, or `send <session>: '<command>'`; undefined for other
 * labels.
 */
export const terminalMarker = (label: string): TerminalMarker | undefined => {
  const command = sentCommand(label);
  const send = /^send ([^:]+): /.exec(label);
  if (command !== undefined && send?.[1]) {
    return { action: "send", session: send[1], command };
  }
  const other = /^(open|read) (\S+)$/.exec(label);
  if (other?.[2] && (other[1] === "open" || other[1] === "read")) {
    return { action: other[1], session: other[2] };
  }
  return undefined;
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

/** A command's first line, with an ellipsis when more lines follow. */
export const commandLabel = (command: string): string => {
  const lines = command.trimEnd().split("\n");
  const first = (lines[0] ?? "").trim();
  return lines.length > 1 ? `${first} …` : first;
};

const parseEvent = (line: string): CastEvent | undefined => {
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
