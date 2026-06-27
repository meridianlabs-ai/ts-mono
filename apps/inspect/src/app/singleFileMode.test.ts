import { describe, expect, it } from "vitest";

import {
  deriveSingleFileLogDir,
  detectInitialSingleFileMode,
} from "./singleFileMode";

const docWithEmbedded = (
  hasEmbedded: boolean
): Pick<Document, "getElementById"> => ({
  getElementById: (id: string) =>
    hasEmbedded && id === "logview-state" ? ({} as HTMLElement) : null,
});

const emptyDoc = docWithEmbedded(false);

describe("detectInitialSingleFileMode", () => {
  it("does not trust URL selection before approval", () => {
    expect(detectInitialSingleFileMode(emptyDoc, false)).toBe(false);
  });

  it("uses an approved URL selection", () => {
    expect(detectInitialSingleFileMode(emptyDoc, true)).toBe(true);
  });

  it("returns true when embedded logview-state element is present", () => {
    expect(
      detectInitialSingleFileMode(docWithEmbedded(true), false, true)
    ).toBe(true);
  });

  it("does not trust embedded host state outside VS Code", () => {
    expect(
      detectInitialSingleFileMode(docWithEmbedded(true), false, false)
    ).toBe(false);
  });
});

describe("deriveSingleFileLogDir", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["file.eval", undefined],
    ["/abs/path/file.eval", "/abs/path"],
    ["relative/path/file.eval", "relative/path"],
    ["s3://bucket/path/file.eval", "s3://bucket/path"],
  ])("derives %s -> %s", (input, expected) => {
    expect(deriveSingleFileLogDir(input)).toBe(expected);
  });
});
