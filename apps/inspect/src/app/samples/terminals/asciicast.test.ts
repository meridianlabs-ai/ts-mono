import { describe, expect, it } from "vitest";

import {
  castHeader,
  highlightCommandEchoes,
  storeCasts,
  terminalMarker,
} from "./asciicast";

describe("storeCasts", () => {
  it("collects asciinema-prefixed string entries, named by suffix", () => {
    const cast = '{"version": 2}\n[0.1, "o", "hi"]';
    expect(
      storeCasts({
        "asciinema:terminal-main": cast,
        "asciinema:terminal-server": cast,
        "tool:state": { pointer: "s3://..." },
        plain: "value",
      })
    ).toEqual([
      { key: "asciinema:terminal-main", name: "terminal-main", cast },
      { key: "asciinema:terminal-server", name: "terminal-server", cast },
    ]);
  });

  it("skips non-string values under the prefix", () => {
    expect(storeCasts({ "asciinema:odd": 42 })).toEqual([]);
  });
});

describe("castHeader", () => {
  it("reads the start time and inspect_ranges session/agent fields", () => {
    const cast = JSON.stringify({
      version: 2,
      width: 160,
      height: 40,
      timestamp: 1792950894,
      ir_session: "tests",
      ir_agent_span_id: "span-1",
      ir_agent: "test-runner",
    });
    expect(castHeader(cast)).toEqual({
      rows: 40,
      cols: 160,
      timestamp: 1792950894,
      session: "tests",
      agentSpanId: "span-1",
      agentName: "test-runner",
    });
  });

  it("leaves out absent or mistyped fields", () => {
    expect(
      castHeader('{"version": 2, "timestamp": "soon", "ir_session": ""}')
    ).toEqual({ rows: 24, cols: 80 });
  });

  it("falls back to 80x24 on an unparseable header", () => {
    expect(castHeader("not json\nmore")).toEqual({ rows: 24, cols: 80 });
  });
});

describe("terminalMarker", () => {
  it("parses send, open and read markers", () => {
    expect(terminalMarker("send tests: 'npm test\\n'")).toEqual({
      action: "send",
      session: "tests",
      command: "npm test\n",
    });
    expect(terminalMarker("open server")).toEqual({
      action: "open",
      session: "server",
    });
    expect(terminalMarker("read build")).toEqual({
      action: "read",
      session: "build",
    });
  });

  it("is undefined for other labels", () => {
    expect(terminalMarker("send make")).toBeUndefined();
    expect(terminalMarker("clipped to the tail")).toBeUndefined();
  });
});

describe("highlightCommandEchoes", () => {
  const outputs = (cast: string): unknown[] =>
    cast
      .split("\n")
      .slice(1)
      .map((line): unknown => JSON.parse(line))
      .filter((event) => Array.isArray(event) && event[1] === "o")
      .map((event) =>
        Array.isArray(event) && typeof event[2] === "string"
          ? event[2]
          : undefined
      );

  it("styles the echoed command line, not the output after it", () => {
    const cast = [
      '{"version": 2}',
      JSON.stringify([1, "m", "send main: 'id\\n'"]),
      JSON.stringify([1.5, "o", "$ id\r\nuid=1000(agent)\r\n"]),
    ].join("\n");
    expect(outputs(highlightCommandEchoes(cast))).toEqual([
      "\x1b[1;38;2;130;170;255m$ id\x1b[22;39m\r\nuid=1000(agent)\r\n",
    ]);
  });

  it("styles continuation lines of a multi-line command", () => {
    const cast = [
      '{"version": 2}',
      JSON.stringify([1, "m", "send main: \"cat > a <<'EOF'\\nx\\nEOF\\n\""]),
      JSON.stringify([1.5, "o", "cat > a <<'EOF'\r\n> x\r\n> EOF\r\n$ "]),
    ].join("\n");
    expect(outputs(highlightCommandEchoes(cast))).toEqual([
      "\x1b[1;38;2;130;170;255mcat > a <<'EOF'\x1b[22;39m\r\n\x1b[1;38;2;130;170;255m> x\x1b[22;39m\r\n\x1b[1;38;2;130;170;255m> EOF\x1b[22;39m\r\n$ ",
    ]);
  });

  it("leaves a chunk that ends mid-escape alone", () => {
    const cast = [
      '{"version": 2}',
      JSON.stringify([1, "m", "send main: 'id\\n'"]),
      JSON.stringify([1.5, "o", "$ id\x1b[3"]),
    ].join("\n");
    expect(highlightCommandEchoes(cast)).toBe(cast);
  });

  it("leaves output alone when it doesn't echo the command", () => {
    const cast = [
      '{"version": 2}',
      JSON.stringify([1, "m", "send main: 'C-c'"]),
      JSON.stringify([1.5, "o", "^C\r\n$ "]),
      JSON.stringify([2, "m", "read main"]),
      JSON.stringify([2.5, "o", "more output"]),
    ].join("\n");
    expect(highlightCommandEchoes(cast)).toBe(cast);
  });
});
