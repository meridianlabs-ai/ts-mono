import { describe, expect, it } from "vitest";

import { parseKeyValueLines } from "./FormFields";

describe("parseKeyValueLines", () => {
  it("parses key=value lines, preserving numbers", () => {
    expect(parseKeyValueLines("a=1\nb=two", false)).toEqual({
      a: 1,
      b: "two",
    });
  });

  it("returns path-like input as a string when paths are allowed", () => {
    expect(parseKeyValueLines("/path/to/config.yaml", true)).toBe(
      "/path/to/config.yaml"
    );
    expect(parseKeyValueLines("~/config.yaml", true)).toBe("~/config.yaml");
  });

  it("parses path-looking key=value input as pairs when paths are not allowed", () => {
    expect(parseKeyValueLines("~team=infra", false)).toEqual({
      "~team": "infra",
    });
  });

  it("returns null when nothing parses", () => {
    expect(parseKeyValueLines("", false)).toBeNull();
    expect(parseKeyValueLines("/no/pairs/here", false)).toBeNull();
    expect(parseKeyValueLines(null, true)).toBeNull();
  });
});
