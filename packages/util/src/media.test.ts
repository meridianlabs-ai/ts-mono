import { describe, expect, it } from "vitest";

import {
  isRenderableImageSource,
  parseAbsoluteHttpUrl,
  parseDataUri,
} from "./media";

describe("parseDataUri", () => {
  it.each([
    ["data:image/png;base64,AAAA", "image/png", true],
    ["DATA:audio/mpeg;BASE64,AAAA", "audio/mpeg", true],
    ["data:text/plain;charset=utf-8,hello", "text/plain", false],
  ])("parses %s", (value, mimeType, base64) => {
    expect(parseDataUri(value)).toEqual({ mimeType, base64 });
  });

  it.each([
    "",
    "https://example.com/image.png",
    "data:,missing-type",
    "data:image/png",
  ])("rejects %s", (value) => {
    expect(parseDataUri(value)).toBeUndefined();
  });
});

describe("parseAbsoluteHttpUrl", () => {
  it.each([
    ["https://example.com/image.png", "https://example.com/image.png"],
    ["http://example.com:8080/a?b=c", "http://example.com:8080/a?b=c"],
    [" HTTPS://EXAMPLE.COM/a ", "https://example.com/a"],
  ])("accepts %s", (value, expected) => {
    expect(parseAbsoluteHttpUrl(value)).toBe(expected);
  });

  it.each([
    "",
    "/relative/image.png",
    "//example.com/image.png",
    "file:///tmp/image.png",
    "blob:https://example.com/id",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "custom://asset/1",
  ])("rejects %s", (value) => {
    expect(parseAbsoluteHttpUrl(value)).toBeUndefined();
  });
});

describe("isRenderableImageSource", () => {
  it.each([
    "data:image/png;base64,AAAA",
    "data:image/gif;base64,AAAA",
    "data:image/jpeg;base64,AAAA",
    "data:image/jpg;base64,AAAA",
    "data:image/webp;base64,AAAA",
    "data:image/avif;base64,AAAA",
    "data:image/bmp;base64,AAAA",
    "data:image/x-icon;base64,AAAA",
    "data:image/vnd.microsoft.icon;base64,AAAA",
    "data:IMAGE/PNG;BASE64,AAAA",
  ])("allows %s", (source) => {
    expect(isRenderableImageSource(source)).toBe(true);
  });

  it.each([
    "data:image/svg+xml;base64,AAAA",
    "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
    "data:image/png,AAAA",
    "data:text/html;base64,AAAA",
    "https://example.com/image.png",
    "file:///tmp/image.png",
    "blob:https://example.com/id",
    "",
    "not a url",
  ])("rejects %s", (source) => {
    expect(isRenderableImageSource(source)).toBe(false);
  });
});
