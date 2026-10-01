import { describe, expect, it } from "vitest";

import { isAnsiOutput, stripAnsi } from "./ansi";

describe("isAnsiOutput", () => {
  it.each<[string, string, boolean]>([
    ["CSI color sequence", "\x1b[31mred\x1b[0m", true],
    ["CSI cursor movement", "\x1b[2J\x1b[H", true],
    [
      "OSC hyperlink terminated by BEL",
      "\x1b]8;;https://x\x07text\x1b]8;;\x07",
      true,
    ],
    ["OSC title terminated by ESC \\", "\x1b]0;title\x1b\\", true],
    ["simple escape (reverse index)", "\x1bM", true],
    [
      "plain text with stray brackets",
      "plain text with ] and [ brackets",
      false,
    ],
    ["OSC with no terminator", "\x1b]0;unterminated title", false],
    ["OSC terminator on a later line", "\x1b]0;title\nmore\x07", false],
    ["empty string", "", false],
  ])("%s", (_name, text, expected) => {
    expect(isAnsiOutput(text)).toBe(expected);
  });

  it("scans unterminated OSC introducers in linear time", () => {
    // Attacker-authored tool output: many `ESC ]` with no BEL / ESC \.
    // Before the fix each introducer rescanned to end of input, ~N^2/2 steps
    // (200k pairs took ~20s); after it the whole string is one pass.
    const text = "\x1b]".repeat(200_000);
    const start = performance.now();
    const result = isAnsiOutput(text);
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("stripAnsi", () => {
  it.each([
    ["\u001b[32mPASS\u001b[0m all", "PASS all"],
    ["\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007", "link"],
    ["plain text", "plain text"],
  ])("strips %j", (input, expected) => {
    expect(stripAnsi(input)).toBe(expected);
  });

  it("strips every sequence on repeated calls", () => {
    const input = "\u001b[31ma\u001b[0m b \u001b[32mc\u001b[0m";
    expect(stripAnsi(input)).toBe("a b c");
    expect(stripAnsi(input)).toBe("a b c");
  });
});
