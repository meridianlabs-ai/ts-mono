// @vitest-environment jsdom
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  assertNoNewFinding,
  classify,
  evaluateInput,
  findXssViolations,
  inputArb,
} from "./markdownSanitizerFuzzer";

// Overridable so the same suite doubles as a hunting tool:
//   FUZZ_RUNS=200000 FUZZ_SEED=42 pnpm vitest run markdownSanitizer.fuzz
// A failing run prints the shrunk counterexample plus the seed to replay it.
const NUM_RUNS = Number(process.env.FUZZ_RUNS ?? 5000);
const SEED = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : undefined;

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

  // Core security invariant: across fast-check-generated adversarial inputs
  // (hand-authored vectors + the cure53/DOMPurify corpus), nothing dangerous
  // survives the sanitizer at either entry point, and it never throws with an
  // unexpected error. fast-check shrinks any counterexample to a minimal repro.
  it(`no new XSS bypass or unexpected throw (${NUM_RUNS} runs)`, () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        assertNoNewFinding(input);
      }),
      { numRuns: NUM_RUNS, seed: SEED }
    );
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

  it("classify identifies the sanitizer-throws defect", () => {
    expect(classify("html", "<svg><style>a{}</style></svg>").kind).toBe(
      "sanitizer-threw"
    );
  });
});
