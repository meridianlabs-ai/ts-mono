// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdownRendering";
import { mathJaxStyles } from "./mathjaxStyles";

/**
 * Drift check for the viewer-owned MathJax stylesheet.
 *
 * markdown-it-mathjax3 wraps every formula in `<span id="mjx-…"><style>…`
 * carrying MathJax's SVG stylesheet. The sanitizer never uses that text
 * (a log could forge the wrapper), and substitutes the fixed copy in
 * mathjaxStyles.ts instead. That copy therefore has to track the
 * stylesheet the installed MathJax emits, and this test is what notices
 * when it stops doing so.
 *
 * If it fails after a dependency upgrade: render a formula, read the
 * authored sheet out of the raw output, and either port the changed rule
 * into mathjaxStyles.ts or, when the viewer should deliberately differ,
 * record the difference in OMITTED_SELECTORS, DEVIATIONS or ADDITIONS
 * below with the reason. Every entry in those lists is asserted to still
 * be needed, so stale entries fail too.
 */

interface Declaration {
  value: string;
  important: boolean;
}
type Rule = Map<string, Declaration>;
type Sheet = Map<string, Rule>;

const WRAPPER = "wrapper";

// Rules MathJax emits that the viewer drops entirely.
const OMITTED_SELECTORS: Record<string, string> = {
  '[jax="svg"] mjx-tool': "runtime tooltips are never present in static SVG",
  '[jax="svg"] mjx-tool > mjx-tip':
    "runtime tooltips are never present in static SVG",
  "mjx-tool > mjx-tip": "runtime tooltips are never present in static SVG",
  "mjx-status": "runtime status line; fixed positioning is never admitted",
  "foreignobject[data-mjx-xml]": "foreignobject is a forbidden tag",
  '.mathjax g[data-mml-node="xypic"] path':
    "subset of the unqualified xypic rule with the same declaration",
};

// Declarations MathJax emits that the viewer changes or removes. `authored`
// is the effective value after the plugin's own !important overrides.
const DEVIATIONS: {
  selector: string;
  property: string;
  authored: Declaration;
  fixed: Declaration | undefined;
  reason: string;
}[] = [
  {
    selector: 'mjx-container[jax="svg"] > svg',
    property: "overflow",
    authored: { value: "visible", important: false },
    fixed: { value: "clip", important: false },
    reason: "a forged wrapper could paint a 1x1 SVG's shapes across the viewer",
  },
  {
    selector: "mjx-assistive-mml",
    property: "clip",
    authored: { value: "auto", important: true },
    fixed: { value: "rect(1px, 1px, 1px, 1px)", important: true },
    reason: "the accessible copy stays clipped even when a log forges it",
  },
  {
    selector: "mjx-assistive-mml",
    property: "color",
    authored: { value: "rgba(0, 0, 0, 0)", important: false },
    fixed: undefined,
    reason: "the plugin made the copy a transparent overlay; it is clipped now",
  },
  ...[
    "-webkit-touch-callout",
    "-webkit-user-select",
    "-khtml-user-select",
    "-moz-user-select",
    "-ms-user-select",
  ].map((property) => ({
    selector: "mjx-assistive-mml",
    property,
    authored: { value: "none", important: false },
    fixed: undefined,
    reason: "prefixed user-select: none would defeat selecting formula text",
  })),
];

// Declarations the viewer adds that MathJax does not emit.
const ADDITIONS: {
  selector: string;
  property: string;
  fixed: Declaration;
  reason: string;
}[] = [
  {
    selector: 'mjx-container[jax="svg"]',
    property: "position",
    fixed: { value: "relative", important: false },
    reason:
      "inline position is not admitted; MathJax put this on the container inline",
  },
  {
    selector: 'mjx-container[jax="svg"] > svg',
    property: "overflow-clip-margin",
    fixed: { value: "1em", important: false },
    reason: "room for glyph overhang and small \\rlap/\\llap overlaps",
  },
];

const normalizeSelector = (selector: string): string => {
  const stripped = selector
    .replace(/#mjx-[a-f0-9]+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!stripped) {
    return WRAPPER;
  }
  return stripped
    .split(",")
    .map((part) => part.trim())
    .sort()
    .join(", ");
};

const BOX_PROPERTIES = new Set(["margin", "padding"]);

const normalizeValue = (property: string, value: string): string => {
  const spaced = value
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (!BOX_PROPERTIES.has(property)) {
    return spaced;
  }
  const [top = "", right = top, bottom = top, left = right] = spaced
    .split(" ")
    .map((side) => (side === "0" ? "0px" : side));
  return [top, right, bottom, left].join(" ");
};

// Later declarations win unless an earlier one is !important, mirroring the
// cascade between the plugin's overrides and MathJax's own rules.
const addDeclarations = (rule: Rule, body: string): void => {
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const rawValue = declaration.slice(colon + 1).trim();
    const important = /!important$/i.test(rawValue);
    const value = normalizeValue(
      property,
      rawValue.replace(/\s*!important$/i, "")
    );
    const existing = rule.get(property);
    if (existing?.important && !important) {
      continue;
    }
    rule.set(property, { value, important });
  }
};

const ruleFor = (sheet: Sheet, selector: string): Rule => {
  const existing = sheet.get(selector);
  if (existing) {
    return existing;
  }
  const rule: Rule = new Map();
  sheet.set(selector, rule);
  return rule;
};

// Handles the one level of nesting the plugin emits: declarations before a
// nested block belong to the enclosing rule.
const parseSheet = (css: string): Sheet => {
  const sheet: Sheet = new Map();
  const stack: string[] = [];
  let buffer = "";
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") {
      const declarationsEnd = buffer.lastIndexOf(";");
      const enclosing = stack[stack.length - 1];
      if (enclosing !== undefined && declarationsEnd !== -1) {
        addDeclarations(
          ruleFor(sheet, enclosing),
          buffer.slice(0, declarationsEnd + 1)
        );
      }
      stack.push(normalizeSelector(buffer.slice(declarationsEnd + 1)));
      buffer = "";
    } else if (char === "}") {
      const selector = stack.pop();
      if (selector !== undefined) {
        addDeclarations(ruleFor(sheet, selector), buffer);
      }
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return sheet;
};

const describeDeclaration = (declaration: Declaration | undefined): string =>
  declaration
    ? `${declaration.value}${declaration.important ? " !important" : ""}`
    : "(absent)";

describe("mathjaxStyles tracks the stylesheet MathJax emits", () => {
  let authored: Sheet;
  const fixed = parseSheet(mathJaxStyles("mjx-a1"));

  beforeAll(async () => {
    const raw = await renderMarkdown("$x$", "full");
    const style = /<style>([\s\S]*?)<\/style>/.exec(raw)?.[1];
    expect(style, "MathJax output no longer carries a <style>").toBeDefined();
    authored = parseSheet(style ?? "");
  });

  it("carries every MathJax rule, except the listed omissions and deviations", () => {
    for (const [selector, rule] of authored) {
      if (selector in OMITTED_SELECTORS) {
        expect(fixed.has(selector), `${selector} is listed as omitted`).toBe(
          false
        );
        continue;
      }
      const fixedRule = fixed.get(selector);
      expect(
        fixedRule,
        `fixed sheet lacks the rule for ${selector}`
      ).toBeDefined();
      for (const [property, declaration] of rule) {
        const deviation = DEVIATIONS.find(
          (entry) => entry.selector === selector && entry.property === property
        );
        const label = `${selector} { ${property} }`;
        if (deviation) {
          expect(declaration, `MathJax changed ${label}`).toEqual(
            deviation.authored
          );
          expect(fixedRule?.get(property), `deviation for ${label}`).toEqual(
            deviation.fixed
          );
          continue;
        }
        expect(
          describeDeclaration(fixedRule?.get(property)),
          `${label} drifted from MathJax`
        ).toBe(describeDeclaration(declaration));
      }
    }
  });

  it("adds nothing beyond the listed additions", () => {
    for (const [selector, rule] of fixed) {
      const authoredRule = authored.get(selector);
      expect(authoredRule, `MathJax no longer emits ${selector}`).toBeDefined();
      for (const [property, declaration] of rule) {
        if (authoredRule?.has(property)) {
          continue;
        }
        const addition = ADDITIONS.find(
          (entry) => entry.selector === selector && entry.property === property
        );
        expect(
          addition,
          `${selector} { ${property} } is not a listed addition`
        ).toBeDefined();
        expect(declaration).toEqual(addition?.fixed);
      }
    }
  });

  it("lists only omissions, deviations and additions that still apply", () => {
    for (const selector of Object.keys(OMITTED_SELECTORS)) {
      expect(authored.has(selector), `${selector} is no longer emitted`).toBe(
        true
      );
    }
    for (const { selector, property } of DEVIATIONS) {
      expect(
        authored.get(selector)?.has(property),
        `${selector} { ${property} } is no longer emitted`
      ).toBe(true);
    }
    for (const { selector, property } of ADDITIONS) {
      expect(
        authored.get(selector)?.has(property),
        `MathJax now emits ${selector} { ${property} } itself`
      ).toBe(false);
    }
  });
});
