import { describe, expect, test } from "vitest";

import { readHostCapabilities } from "./host-capabilities";

function docWith(textContent: string | null): Pick<Document, "getElementById"> {
  const el = document.createElement("script");
  el.textContent = textContent;
  return {
    getElementById: (id: string) =>
      id === "inspect-host-capabilities" && textContent !== null ? el : null,
  };
}

describe("readHostCapabilities", () => {
  test("parses a capability list", () => {
    expect(readHostCapabilities(docWith('["http_request"]'))).toEqual([
      "http_request",
    ]);
  });

  test("returns [] when the marker is absent (old extension)", () => {
    expect(readHostCapabilities(docWith(null))).toEqual([]);
  });

  test("returns [] on malformed content", () => {
    expect(readHostCapabilities(docWith("not json"))).toEqual([]);
  });

  test("returns [] when the JSON is valid but not an array", () => {
    expect(readHostCapabilities(docWith('{"a":1}'))).toEqual([]);
  });
});
