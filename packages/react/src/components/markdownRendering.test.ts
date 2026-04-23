import { describe, expect, it } from "vitest";

import {
  balanceBackticks,
  escapeShellInterpolation,
  protectBackslashesInLatex,
  renderMarkdown,
  restoreBackslashesForLatex,
  unescapeHtmlForMath,
} from "./markdownRendering";

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
    const result = renderMarkdown("${sadsa}-${bar}");
    expect(result).not.toContain("<mjx-container");
    expect(result).not.toContain("math_inline");
  });

  it("should render unterminated backtick with shell vars as code", () => {
    const result = renderMarkdown('`foo="${x}-${y}"...');
    expect(result).toContain("<code>");
    expect(result).not.toContain("<mjx-container");
  });

  it("should still render $x^2$ as math", () => {
    const result = renderMarkdown("$x^2$");
    expect(result).toContain("<mjx-container");
  });

  it("should still render ${x \\in S}$ as math", () => {
    const result = renderMarkdown("${x \\in S}$");
    expect(result).toContain("<mjx-container");
  });

  it("should still render $$\\sum x$$ as block math", () => {
    const result = renderMarkdown("$$\\sum x$$");
    expect(result).toContain("<mjx-container");
  });

  it("should still render balanced backtick code normally", () => {
    const result = renderMarkdown("`code`");
    expect(result).toContain("<code>");
    expect(result).not.toContain("<mjx-container");
  });
});

describe("MarkdownDiv XSS security", () => {
  describe("script injection in LaTeX blocks", () => {
    it("should not produce raw <script> tags from inline math", () => {
      const result = renderMarkdown("$<script>alert(1)</script>$");
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("</script>");
    });

    it("should not produce raw <script> tags from block math", () => {
      const result = renderMarkdown("$$<script>alert(1)</script>$$");
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("</script>");
    });
  });

  describe("event handler injection in LaTeX blocks", () => {
    it("should not produce raw <img> with onerror from inline math", () => {
      const result = renderMarkdown('$<img src=x onerror="alert(1)">$');
      expect(result).not.toContain("<img");
      expect(result).not.toContain("onerror");
    });

    it("should not produce raw <img> with onerror from block math", () => {
      const result = renderMarkdown('$$<img src=x onerror="alert(1)">$$');
      expect(result).not.toContain("<img");
      expect(result).not.toContain("onerror");
    });
  });

  describe("script injection outside LaTeX", () => {
    it("should escape <script> tags in plain text", () => {
      const result = renderMarkdown("<script>alert(1)</script>");
      expect(result).not.toContain("<script>");
    });

    it("should escape event handlers in plain text", () => {
      const result = renderMarkdown('<img src=x onerror="alert(1)">');
      // The text "onerror" may appear as escaped text, but no raw <img> tag
      expect(result).not.toContain("<img");
    });
  });

  describe("legitimate LaTeX still renders", () => {
    it("should render inline math with backslashes", () => {
      const result = renderMarkdown("$\\frac{1}{2}$");
      // MathJax should process this — output should contain mjx-container or similar
      // At minimum, the backslash commands should not be entity-encoded
      expect(result).not.toContain("___LATEX_BACKSLASH___");
    });

    it("should render block math with backslashes", () => {
      const result = renderMarkdown("$$\\sum_{i=0}^{n} x_i$$");
      expect(result).not.toContain("___LATEX_BACKSLASH___");
    });

    it("should render math with comparison operators via unescapeHtmlForMath", () => {
      // The unescapeHtmlForMath helper should restore < and > for MathJax
      const unescaped = unescapeHtmlForMath("x &lt; y");
      expect(unescaped).toBe("x < y");
    });

    it("should unescape all HTML entities for math", () => {
      const input = "&lt; &gt; &amp; &apos; &quot;";
      const result = unescapeHtmlForMath(input);
      expect(result).toBe("< > & ' \"");
    });
  });

  describe("protectBackslashesInLatex only protects backslashes", () => {
    it("should protect backslashes in inline math", () => {
      const result = protectBackslashesInLatex("$\\frac{1}{2}$");
      expect(result).toContain("___LATEX_BACKSLASH___");
      expect(result).not.toContain("___LATEX_LT___");
    });

    it("should NOT protect < > & in inline math", () => {
      const result = protectBackslashesInLatex("$x < y & z > w$");
      // < > & should remain as-is (for escapeHtmlCharacters to handle)
      expect(result).toContain("<");
      expect(result).toContain(">");
      expect(result).toContain("&");
      expect(result).not.toContain("___LATEX_LT___");
      expect(result).not.toContain("___LATEX_GT___");
      expect(result).not.toContain("___LATEX_AMP___");
    });

    it("should NOT protect < > & in block math", () => {
      const result = protectBackslashesInLatex("$$x < y$$");
      expect(result).toContain("<");
      expect(result).not.toContain("___LATEX_LT___");
    });
  });

  describe("restoreBackslashesForLatex only restores backslashes", () => {
    it("should restore backslash placeholders", () => {
      const result = restoreBackslashesForLatex("___LATEX_BACKSLASH___frac");
      expect(result).toBe("\\frac");
    });

    it("should not restore HTML character placeholders (they no longer exist)", () => {
      // These placeholders should not appear in the pipeline anymore,
      // but verify the function doesn't have leftover handling
      const input = "&lt;script&gt;";
      const result = restoreBackslashesForLatex(input);
      expect(result).toBe("&lt;script&gt;");
    });
  });
});
