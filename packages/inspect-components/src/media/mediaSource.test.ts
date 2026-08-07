import { describe, expect, it } from "vitest";

import {
  isRenderableAudioSource,
  isRenderableImageDocument,
  isRenderableVideoSource,
} from "./mediaSource";

// isRenderableImageSource now lives in @tsmono/util and is covered by
// packages/util/src/media.test.ts; this file covers only the predicates that
// stayed behind because they key off generated inspect-common format types.
describe("inline media policy", () => {
  it.each([
    ["data:audio/mpeg;base64,AAAA", "mp3"],
    ["data:audio/wav;base64,AAAA", "wav"],
    ["data:video/mp4;base64,AAAA", "mp4"],
    ["data:video/mpeg;base64,AAAA", "mpeg"],
    ["data:video/quicktime;base64,AAAA", "mov"],
  ] as const)("allows matching %s as %s", (source, format) => {
    if (format === "mp3" || format === "wav") {
      expect(isRenderableAudioSource(source, format)).toBe(true);
    } else {
      expect(isRenderableVideoSource(source, format)).toBe(true);
    }
  });

  it("rejects mismatched audio and video formats", () => {
    expect(isRenderableAudioSource("data:audio/wav;base64,AAAA", "mp3")).toBe(
      false
    );
    expect(isRenderableVideoSource("data:video/mp4;base64,AAAA", "mov")).toBe(
      false
    );
  });

  it("requires image document metadata to match the data URI", () => {
    expect(
      isRenderableImageDocument("data:image/jpeg;base64,AAAA", "image/jpeg")
    ).toBe(true);
    expect(
      isRenderableImageDocument("data:image/jpeg;base64,AAAA", "image/png")
    ).toBe(false);
    expect(
      isRenderableImageDocument(
        "data:image/svg+xml;base64,AAAA",
        "image/svg+xml"
      )
    ).toBe(false);
  });
});
