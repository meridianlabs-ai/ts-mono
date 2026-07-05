// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  evaluateInput,
  findXssViolations,
  formatFinding,
  runFuzzer,
} from "./markdownSanitizerFuzzer";

// Overridable so the same suite doubles as a hunting tool:
//   FUZZ_ITERATIONS=200000 FUZZ_SEED=42 pnpm vitest run markdownSanitizer.fuzz
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 3000);
const SEED = Number(process.env.FUZZ_SEED ?? 0x9e3779b1);

describe("markdown sanitizer fuzzing", () => {
  it("does not flag benign markdown (oracle sanity check)", () => {
    const benign = [
      "# Title\n\nSome **bold** and _italic_ text with a [link](https://example.com).",
      "Inline math $x^2 + y^2 = z^2$ and a block:\n\n$$\\frac{a}{b} = \\sqrt{c}$$",
      "`code span` and\n\n```\nfenced block\n```",
      "A comparison in math: $a < b$ and $c > d$.",
      "![diagram](https://example.com/img.png)",
    ];
    for (const md of benign) {
      expect(
        findXssViolations(evaluateInput("markdown", md).sanitized)
      ).toEqual([]);
    }
  });

  it("blocks the known MathJax href injection", () => {
    const payload = '$\\href{x"><animate onbegin=alert(1)>}{z}$';
    expect(evaluateInput("markdown", payload).violations).toEqual([]);
  });

  // The core security invariant: nothing dangerous survives the sanitizer at
  // either entry point (rendered markdown/MathJax, or post-processed HTML).
  it(`finds no XSS bypass across ${ITERATIONS} fuzzed inputs`, () => {
    const finding = runFuzzer({
      iterations: ITERATIONS,
      seed: SEED,
      kinds: ["xss"],
    });
    if (finding) {
      console.error(formatFinding(finding));
    }
    expect(finding).toBeNull();
  }, 120_000);

  // FINDING (fuzzer): sanitizeRenderedHtml throws — rather than returning
  // sanitized HTML — on `<style>` inside SVG/MathML foreign content. Root cause
  // is the `uponSanitizeElement` hook calling `node.remove()` on a node that
  // DOMPurify then also force-removes ("refusing to sanitize in place"). The
  // sanitizer feeds `dangerouslySetInnerHTML`, so a throw is a render crash /
  // failed-to-display, not safe output — a hardening backstop should never
  // throw on adversarial input. `it.fails` keeps this green today and turns red
  // (drop the `.fails`) once the hook stops detaching nodes itself.
  it.fails(
    "sanitizeRenderedHtml never throws on <style> in foreign content",
    () => {
      for (const payload of [
        "<svg><style>a{}</style></svg>",
        "<math><style>a{}</style></math>",
        "<math><mtext><mglyph><style><img src=x onerror=alert(1)></style></mglyph></mtext></math>",
      ]) {
        expect(() => evaluateInput("html", payload)).not.toThrow();
      }
    }
  );

  // The fuzzer discovers the throw on its own when both kinds are reported.
  it("fuzzer surfaces the sanitizer-throws defect", () => {
    const finding = runFuzzer({
      iterations: ITERATIONS,
      seed: SEED,
      kinds: ["sanitizer-threw"],
    });
    expect(finding?.kind).toBe("sanitizer-threw");
  }, 120_000);
});
