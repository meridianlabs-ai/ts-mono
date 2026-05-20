/**
 * Regression test for the inline tag rail in PrimaryBar.
 *
 * jsdom doesn't run a CSS layout engine, so we can't observe the visual
 * overflow that hides the Edit button when several long tags are added.
 * Instead we pin the CSS contract that makes the bug impossible:
 *
 *   - `.tagRow` must be shrinkable inside `.bodyContainer`. Without this,
 *     a multi-chip row grows to its content's natural width and pushes
 *     the trailing Edit button past the right edge of the header.
 *   - `.tagRow` must wrap its children. With shrinkability in place,
 *     wrap is what actually keeps the row inside the available width.
 *   - `min-width: 0` is required because a flex item's default
 *     `min-width: auto` resolves to its content's intrinsic minimum,
 *     which prevents shrinking even when `flex-shrink: 1` is set.
 *
 * If a future change re-introduces `flex-shrink: 0` on `.tagRow`, this
 * test will catch the regression at the rule level.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const CSS_PATH = path.join(__dirname, "PrimaryBar.module.css");
const css = fs.readFileSync(CSS_PATH, "utf8");

function ruleBlock(name: string): string {
  // Strip CSS comments so explanatory text inside the block (which may
  // describe the very thing the rule no longer does) doesn't trip the
  // regex below.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Capture the first `{...}` after a `.<name>` selector. Good enough for
  // a hand-written stylesheet with one rule per class.
  const re = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`);
  const m = stripped.match(re);
  if (!m) {
    throw new Error(
      `Could not find .${name} rule in ${path.basename(CSS_PATH)}`
    );
  }
  return m[1];
}

// Returns the rule's `flex-shrink` value as a number. Default is `1`.
// Doesn't try to interpret the `flex:` shorthand — the stylesheet uses
// the longhand and we want the test to fail loudly if that changes.
function flexShrink(name: string): number {
  const block = ruleBlock(name);
  const m = block.match(/flex-shrink\s*:\s*(\d+(?:\.\d+)?)\b/);
  return m ? Number(m[1]) : 1;
}

describe("PrimaryBar.tagRow layout contract", () => {
  const block = ruleBlock("tagRow");

  test("does not pin `flex-shrink: 0` (would prevent wrap inside the bodyContainer)", () => {
    expect(block).not.toMatch(/flex-shrink\s*:\s*0\b/);
  });

  test("wraps chips onto additional lines when needed", () => {
    expect(block).toMatch(/flex-wrap\s*:\s*wrap/);
  });

  test("allows shrinking below content width via min-width:0", () => {
    expect(block).toMatch(/min-width\s*:\s*0\b/);
  });
});

describe("PrimaryBar wrapper sizing contract", () => {
  // The outer wrapper is a 2-column grid: body (title/model/tags) on the
  // left, results panel on the right. If column 2 takes a fixed share
  // (e.g. `1fr`), the body is capped at ~half the wrapper even on wide
  // windows — which leaves a large empty gap between the Edit button
  // and the results panel and forces chips to wrap when there's plenty
  // of horizontal space available.
  //
  // The fix is to let column 2 take its content's natural width
  // (`auto`), so the body absorbs all remaining space. This test pins
  // the columns at the rule level — visual layout isn't observable in
  // jsdom.
  test("wrapper grid lets the body absorb the space the results panel doesn't claim", () => {
    const wrapper = ruleBlock("wrapper");
    const cols = wrapper.match(/grid-template-columns\s*:\s*([^;]+);/);
    expect(cols).not.toBeNull();
    const value = cols![1].trim();
    // Right-hand column must not be a fixed fr share.
    expect(value).not.toMatch(/\b1fr\s*$/);
    // It should be one of the natural-sizing keywords. Accept `auto`
    // or `max-content` (anything content-driven). Reject fr units.
    expect(value).toMatch(/(auto|max-content)\s*$/);
  });
});

describe("PrimaryBar shrink-priority contract", () => {
  // When the title + model + chips don't fit on one line, the flex
  // algorithm distributes the deficit proportional to
  //   shrink_factor × flex-basis
  // for each item that can shrink. The tag row's basis (combined chip
  // widths) is typically much larger than the title's, so giving both
  // items the default `flex-shrink: 1` makes the tag row absorb most of
  // the deficit even when the title could ellipsize and free up the
  // entire deficit on its own. The visible symptom is that chips wrap
  // to a second line while the title still shows its full text — which
  // is what users perceive as "wrapping unnecessarily".
  //
  // The fix is to bias the shrink ratio so the title absorbs essentially
  // all of the deficit first. Concretely: title's flex-shrink must be
  // strictly greater than the tag row's so a small deficit is fully
  // absorbed by the title, and chip wrap only activates after the title
  // has been ellipsized to its minimum width.

  test("title shrinks more aggressively than the tag row", () => {
    const titleShrink = flexShrink("taskTitle");
    const tagRowShrink = flexShrink("tagRow");
    expect(titleShrink).toBeGreaterThan(tagRowShrink);
  });

  test("title is the only shrinkable inline-item besides the tag row", () => {
    // Model name should never shrink — losing characters off the model
    // makes the header confusing in a way a truncated task name doesn't.
    expect(ruleBlock("taskModel")).toMatch(/flex-shrink\s*:\s*0\b/);
  });
});
