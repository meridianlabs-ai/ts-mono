import { describe, expect, it } from "vitest";

import { revealHiddenCharacters } from "./hiddenCharacters";

describe("revealHiddenCharacters", () => {
  it("leaves ordinary text, tabs, newlines and CRLF untouched", () => {
    const text = "plain\ttext\nnext line\r\nwindows line — emoji ❤️ ✅";
    expect(revealHiddenCharacters(text)).toBe(text);
  });

  it.each([
    ["zero width space", "a\u200Bb", "a⟨U+200B⟩b"],
    ["zero width joiner", "a\u200Db", "a⟨U+200D⟩b"],
    [
      "right-to-left override",
      "\u202Egnp.exe\u202C",
      "⟨U+202E⟩gnp.exe⟨U+202C⟩",
    ],
    ["bidi isolate", "\u2066x\u2069", "⟨U+2066⟩x⟨U+2069⟩"],
    ["byte order mark", "\uFEFFtext", "⟨U+FEFF⟩text"],
    ["soft hyphen", "in\u00ADvisible", "in⟨U+00AD⟩visible"],
    ["escape", "\u001b[32mPASS", "⟨U+001B⟩[32mPASS"],
    ["null", "a\u0000b", "a⟨U+0000⟩b"],
    ["C1 control", "a\u009Bb", "a⟨U+009B⟩b"],
    ["lone carriage return", "old\rnew", "old⟨U+000D⟩new"],
    ["tag character", "a\u{E0041}b", "a⟨U+E0041⟩b"],
    ["variation selector supplement", "a\u{E0100}b", "a⟨U+E0100⟩b"],
  ])("reveals %s", (_name, input, expected) => {
    expect(revealHiddenCharacters(input)).toBe(expected);
  });

  it.each([
    ["an emoji ZWJ sequence", "family 👨\u200D👩\u200D👧 and 🏳️\u200D🌈"],
    ["a skin-toned ZWJ sequence", "👩🏽\u200D💻"],
    ["a Persian ZWNJ", "می\u200Cخواهم"],
    ["a Devanagari ZWJ after virama", "क्\u200Dष"],
  ])("leaves joiners in %s untouched", (_name, text) => {
    expect(revealHiddenCharacters(text)).toBe(text);
  });

  it.each([
    ["between Latin letters", "pass\u200Cword", "pass⟨U+200C⟩word"],
    ["at the end of an emoji", "👍\u200D", "👍⟨U+200D⟩"],
    ["between an emoji and a letter", "👍\u200Da", "👍⟨U+200D⟩a"],
  ])("reveals a joiner %s", (_name, input, expected) => {
    expect(revealHiddenCharacters(input)).toBe(expected);
  });

  it("reveals hidden characters after astral characters and around CRLF", () => {
    expect(revealHiddenCharacters("😀\u202E\r\nx\r")).toBe(
      "😀⟨U+202E⟩\r\nx⟨U+000D⟩"
    );
  });

  it("returns ordinary text unchanged on repeated calls", () => {
    const text = "line one\nline two\ttabbed";
    expect(revealHiddenCharacters(text)).toBe(text);
    expect(revealHiddenCharacters(`${text}\u200B`)).toBe(`${text}⟨U+200B⟩`);
    expect(revealHiddenCharacters(text)).toBe(text);
  });
});
