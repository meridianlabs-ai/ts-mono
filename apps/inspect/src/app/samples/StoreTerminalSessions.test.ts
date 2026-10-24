import { describe, expect, it } from "vitest";

import { castGeometry, storeCasts } from "./StoreTerminalSessions";

describe("storeCasts", () => {
  it("collects asciinema-prefixed string entries, named by suffix", () => {
    const cast = '{"version": 2}\n[0.1, "o", "hi"]';
    expect(
      storeCasts({
        "asciinema:terminal-main": cast,
        "asciinema:terminal-listener": cast,
        "inspect_ranges:evidence": { pointer: "s3://..." },
        plain: "value",
      })
    ).toEqual([
      { key: "asciinema:terminal-main", name: "terminal-main", cast },
      { key: "asciinema:terminal-listener", name: "terminal-listener", cast },
    ]);
  });

  it("skips non-string values under the prefix", () => {
    expect(storeCasts({ "asciinema:odd": 42 })).toEqual([]);
  });
});

describe("castGeometry", () => {
  it("reads width/height from the header line", () => {
    const cast = '{"version": 2, "width": 160, "height": 40}\n[0.1, "o", "x"]';
    expect(castGeometry(cast)).toEqual({ rows: 40, cols: 160 });
  });

  it("falls back to 80x24 on an unparseable or bare header", () => {
    expect(castGeometry("not json\nmore")).toEqual({ rows: 24, cols: 80 });
    expect(castGeometry('{"version": 2}')).toEqual({ rows: 24, cols: 80 });
  });
});
