import { describe, expect, it } from "vitest";

import {
  balanceBackticks,
  escapeHtmlCharacters,
  escapeShellInterpolation,
  getMarkdownInstance,
  protectBackslashesInLatex,
  restoreBackslashesForLatex,
} from "../markdownRendering";

/**
 * Simulate the async rendering pipeline from MarkdownDiv,
 * including the new preprocessing steps.
 */
function renderPipeline(markdown: string, omitMath = false): string {
  const balanced = balanceBackticks(markdown);
  const shellEscaped = escapeShellInterpolation(balanced);
  const protectedContent = protectBackslashesInLatex(shellEscaped);
  const escaped = escapeHtmlCharacters(protectedContent);
  const preparedForMarkdown = restoreBackslashesForLatex(escaped);

  const md = getMarkdownInstance(false, omitMath);
  return md.render(preparedForMarkdown);
}

describe("escapeShellInterpolation", () => {
  it("should escape shell variable ${foo}", () => {
    expect(escapeShellInterpolation("${foo}")).toBe("\\${foo}");
  });

  it("should escape shell variable ${MY_VAR_123}", () => {
    expect(escapeShellInterpolation("${MY_VAR_123}")).toBe("\\${MY_VAR_123}");
  });

  it("should escape multiple shell variables in one string", () => {
    expect(escapeShellInterpolation('foo="${sadsa}-${bar}"')).toBe(
      'foo="\\${sadsa}-\\${bar}"'
    );
  });

  it("should NOT escape math with spaces: ${x \\in S}", () => {
    expect(escapeShellInterpolation("${x \\in S}")).toBe("${x \\in S}");
  });

  it("should NOT escape math with leading space: ${ a + b }", () => {
    expect(escapeShellInterpolation("${ a + b }")).toBe("${ a + b }");
  });

  it("should NOT escape math with backslash: ${n \\choose k}", () => {
    expect(escapeShellInterpolation("${n \\choose k}")).toBe("${n \\choose k}");
  });

  it("should NOT escape normal inline math $x^2$", () => {
    expect(escapeShellInterpolation("$x^2$")).toBe("$x^2$");
  });

  it("should NOT escape empty braces ${}", () => {
    expect(escapeShellInterpolation("${}")).toBe("${}");
  });

  it("should NOT escape digit-leading ${123}", () => {
    expect(escapeShellInterpolation("${123}")).toBe("${123}");
  });

  it("should return empty string unchanged", () => {
    expect(escapeShellInterpolation("")).toBe("");
  });
});

describe("balanceBackticks", () => {
  it("should close a single unterminated backtick", () => {
    expect(balanceBackticks("`foo")).toBe("`foo`");
  });

  it("should not modify already balanced backticks", () => {
    expect(balanceBackticks("`foo`")).toBe("`foo`");
  });

  it("should not modify fenced code blocks", () => {
    const input = "```\ncode\n```";
    expect(balanceBackticks(input)).toBe(input);
  });

  it("should not modify double-backtick inline code", () => {
    const input = "``code``";
    expect(balanceBackticks(input)).toBe(input);
  });

  it("should leave multiple unmatched backticks as-is", () => {
    const input = "`a `b";
    expect(balanceBackticks(input)).toBe(input);
  });

  it("should return empty string unchanged", () => {
    expect(balanceBackticks("")).toBe("");
  });

  it("should handle text with no backticks", () => {
    expect(balanceBackticks("hello world")).toBe("hello world");
  });

  it("should close unterminated backtick with surrounding text", () => {
    expect(balanceBackticks('some `foo="${x}"...')).toBe(
      'some `foo="${x}"...`'
    );
  });
});

describe("pipeline: shell interpolation does not trigger math", () => {
  it("should not render ${sadsa}-${bar} as math", () => {
    const result = renderPipeline("${sadsa}-${bar}");
    expect(result).not.toContain("<mjx-container");
    expect(result).not.toContain("math_inline");
  });

  it("should render unterminated backtick with shell vars as code", () => {
    const result = renderPipeline('`foo="${x}-${y}"...');
    expect(result).toContain("<code>");
    expect(result).not.toContain("<mjx-container");
  });

  it("should still render $x^2$ as math", () => {
    const result = renderPipeline("$x^2$");
    expect(result).toContain("<mjx-container");
  });

  it("should still render ${x \\in S}$ as math", () => {
    const result = renderPipeline("${x \\in S}$");
    expect(result).toContain("<mjx-container");
  });

  it("should still render $$\\sum x$$ as block math", () => {
    const result = renderPipeline("$$\\sum x$$");
    expect(result).toContain("<mjx-container");
  });

  it("should still render balanced backtick code normally", () => {
    const result = renderPipeline("`code`");
    expect(result).toContain("<code>");
    expect(result).not.toContain("<mjx-container");
  });
});
