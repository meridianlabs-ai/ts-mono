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
  it.each([
    ["?log_file=foo.eval", true],
    ["?task_file=foo.eval", true],
    ["?log_file=foo.eval&other=1", true],
    ["?other=1", false],
    ["", false],
  ])("returns %s for query %s", (search, expected) => {
    expect(detectInitialSingleFileMode({ search }, emptyDoc)).toBe(expected);
  });

  it("returns true when embedded logview-state element is present", () => {
    expect(
      detectInitialSingleFileMode({ search: "" }, docWithEmbedded(true))
    ).toBe(true);
  });

  it("does not match log_file as a substring of another param", () => {
    expect(
      detectInitialSingleFileMode({ search: "?my_log_file=foo" }, emptyDoc)
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
