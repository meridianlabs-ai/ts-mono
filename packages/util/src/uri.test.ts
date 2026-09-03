import { describe, expect, test } from "vitest";

import {
  directoryRelativeUrl,
  encodePathParts,
  isUri,
  join,
  prettyDirUri,
  rootName,
} from "./uri";

describe("directoryRelativeUrl", () => {
  test.each([
    ["", undefined, ""],
    ["", "/logs", ""],
    ["nested/file.eval", undefined, "nested/file.eval"],
    ["nested/file.eval", "", "nested/file.eval"],
    ["nested dir/a+b #1.eval", undefined, "nested%20dir/a%2Bb%20%231.eval"],
    ["/logs/run.eval", "/logs", "run.eval"],
    ["/logs/nested/run name.eval", "/logs/", "nested/run%20name.eval"],
    ["/logs dir/nested/a+b.eval", "/logs dir", "nested/a%2Bb.eval"],
    ["C:\\logs\\nested\\run name.eval", "C:\\logs", "nested/run%20name.eval"],
    [
      "D:\\other\\nested\\run name.eval",
      "C:\\logs",
      "D%3A/other/nested/run%20name.eval",
    ],
    ["/other/nested/run name.eval", "/logs", "/other/nested/run%20name.eval"],
    ["/logs-archive/run.eval", "/logs", "/logs-archive/run.eval"],
  ])("makes %j relative to %j", (file, dir, expected) => {
    expect(directoryRelativeUrl(file, dir)).toBe(expected);
  });
});

describe("join", () => {
  test.each([
    ["run.eval", undefined, "run.eval"],
    ["./run.eval", "", "./run.eval"],
    ["", "/logs", "/logs/"],
    ["run.eval", "/logs", "/logs/run.eval"],
    ["nested/run.eval", "/logs/", "/logs/nested/run.eval"],
    ["./nested/run.eval", "/logs", "/logs/nested/run.eval"],
    ["C:\\logs\\nested\\run.eval", "C:\\logs", "C:/logs/nested/run.eval"],
    ["/logs/nested/run.eval", "/logs", "/logs/nested/run.eval"],
    [
      "file:///logs/nested/run.eval",
      "file:///logs",
      "file:///logs/nested/run.eval",
    ],
    ["/logs", "/logs", "/logs"],
    ["/logs", "/logs/", "/logs"],
    ["/logs-archive/run.eval", "/logs", "/logs//logs-archive/run.eval"],
  ])("joins %j to %j", (file, dir, expected) => {
    expect(join(file, dir)).toBe(expected);
  });
});

describe("encodePathParts", () => {
  test.each([
    ["", ""],
    ["nested dir/a+b #1.eval", "nested%20dir/a%2Bb%20%231.eval"],
    [
      "nested%20dir/already%2Bencoded.eval",
      "nested%20dir/already%2Bencoded.eval",
    ],
    ["/nested dir/run.eval", "/nested%20dir/run.eval"],
    [
      "https://example.test/nested dir/a+b.eval?raw=a+b#section",
      "https://example.test/nested%20dir/a%2Bb.eval?raw=a+b#section",
    ],
    [
      "https://example.test/already%20encoded/a%2Bb.eval",
      "https://example.test/already%20encoded/a%2Bb.eval",
    ],
  ])("encodes URL path segments in %j", (value, expected) => {
    expect(encodePathParts(value)).toBe(expected);
  });
});

describe("rootName", () => {
  test.each([
    ["", ""],
    ["run.eval", "run.eval"],
    ["nested/run.eval", "nested"],
    ["nested%20dir/run.eval", "nested%20dir"],
  ])("returns the first segment of %j", (value, expected) => {
    expect(rootName(value)).toBe(expected);
  });
});

describe("isUri", () => {
  test.each([
    ["https://example.test/logs/run.eval", true],
    ["file:///logs/run.eval", true],
    ["mailto:user@example.test", true],
    ["/logs/run.eval", false],
    ["nested/run.eval", false],
    ["", false],
  ])("classifies %j", (value, expected) => {
    expect(isUri(value)).toBe(expected);
  });
});

describe("prettyDirUri", () => {
  test.each([
    ["file:///Users/me/logs", "/Users/me/logs"],
    ["file://server/share/logs", "server/share/logs"],
    ["https://example.test/logs", "https://example.test/logs"],
    ["/Users/me/logs", "/Users/me/logs"],
    ["", ""],
  ])("formats %j", (value, expected) => {
    expect(prettyDirUri(value)).toBe(expected);
  });
});
