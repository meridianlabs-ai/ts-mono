// @vitest-environment jsdom
/// <reference types="@tsmono/util/vite-imports" />
import { expect, it } from "vitest";

import { renderMarkdown } from "./markdownRendering";
import mathJaxCss from "./mathjax.css?raw";

/**
 * Drift check for the viewer-owned MathJax stylesheet in mathjax.css.
 *
 * markdown-it-mathjax3 wraps every formula in `<span id="mjx-…"><style>…`
 * carrying MathJax's SVG stylesheet. The sanitizer drops that element,
 * because a log could forge the wrapper and the viewer's CSP allows no
 * inline <style>; mathjax.css supplies the rules instead. This snapshot pins
 * the stylesheet the installed MathJax emits so a dependency upgrade that
 * changes it fails here rather than silently leaving the copy stale.
 *
 * When it fails: port the changed rules into mathjax.css, then update the
 * snapshot. The copy deliberately differs from the snapshot in these ways,
 * and only these: rules are keyed on `mjx-container[jax="SVG"]` (the
 * wrapper's display: contents on a span holding one) instead of the
 * per-formula id; the tooltip and status rules (mjx-tool, mjx-tip,
 * mjx-status) and the foreignobject rule are omitted; mjx-assistive-mml is
 * clipped with !important and selectable, without the plugin's transparent
 * overlay colour or the prefixed user-select: none declarations; the SVG is
 * clipped with a 1em margin instead of overflow: visible; and the container
 * carries the position: relative that MathJax puts inline.
 */
it("MathJax emits the stylesheet the viewer-owned copy was written from", async () => {
  const raw = await renderMarkdown("$x$", "full");
  const authored = /<style>([\s\S]*?)<\/style>/.exec(raw)?.[1] ?? "";
  const normalized = authored
    .replace(/#mjx-[a-f0-9]+/gi, "#mjx-ID")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  expect(normalized).toMatchInlineSnapshot(`
    "#mjx-ID{
    display:contents;
    mjx-assistive-mml {
    user-select: text !important;
    clip: auto !important;
    color: rgba(0,0,0,0);
    }
    mjx-container[jax="SVG"] {
    direction: ltr;
    }
    mjx-container[jax="SVG"] > svg {
    overflow: visible;
    min-height: 1px;
    min-width: 1px;
    }
    mjx-container[jax="SVG"] > svg a {
    fill: blue;
    stroke: blue;
    }
    mjx-assistive-mml {
    position: absolute !important;
    top: 0px;
    left: 0px;
    clip: rect(1px, 1px, 1px, 1px);
    padding: 1px 0px 0px 0px !important;
    border: 0px !important;
    display: block !important;
    width: auto !important;
    overflow: hidden !important;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
    }
    mjx-assistive-mml[display="block"] {
    width: 100% !important;
    }
    mjx-container[jax="SVG"][display="true"] {
    display: block;
    text-align: center;
    margin: 1em 0;
    }
    mjx-container[jax="SVG"][display="true"][width="full"] {
    display: flex;
    }
    mjx-container[jax="SVG"][justify="left"] {
    text-align: left;
    }
    mjx-container[jax="SVG"][justify="right"] {
    text-align: right;
    }
    g[data-mml-node="merror"] > g {
    fill: red;
    stroke: red;
    }
    g[data-mml-node="merror"] > rect[data-background] {
    fill: yellow;
    stroke: none;
    }
    g[data-mml-node="mtable"] > line[data-line], svg[data-table] > g > line[data-line] {
    stroke-width: 70px;
    fill: none;
    }
    g[data-mml-node="mtable"] > rect[data-frame], svg[data-table] > g > rect[data-frame] {
    stroke-width: 70px;
    fill: none;
    }
    g[data-mml-node="mtable"] > .mjx-dashed, svg[data-table] > g > .mjx-dashed {
    stroke-dasharray: 140;
    }
    g[data-mml-node="mtable"] > .mjx-dotted, svg[data-table] > g > .mjx-dotted {
    stroke-linecap: round;
    stroke-dasharray: 0,140;
    }
    g[data-mml-node="mtable"] > g > svg {
    overflow: visible;
    }
    [jax="SVG"] mjx-tool {
    display: inline-block;
    position: relative;
    width: 0;
    height: 0;
    }
    [jax="SVG"] mjx-tool > mjx-tip {
    position: absolute;
    top: 0;
    left: 0;
    }
    mjx-tool > mjx-tip {
    display: inline-block;
    padding: .2em;
    border: 1px solid #888;
    font-size: 70%;
    background-color: #F8F8F8;
    color: black;
    box-shadow: 2px 2px 5px #AAAAAA;
    }
    g[data-mml-node="maction"][data-toggle] {
    cursor: pointer;
    }
    mjx-status {
    display: block;
    position: fixed;
    left: 1em;
    bottom: 1em;
    min-width: 25%;
    padding: .2em .4em;
    border: 1px solid #888;
    font-size: 90%;
    background-color: #F8F8F8;
    color: black;
    }
    foreignObject[data-mjx-xml] {
    font-family: initial;
    line-height: normal;
    overflow: visible;
    }
    mjx-container[jax="SVG"] path[data-c], mjx-container[jax="SVG"] use[data-c] {
    stroke-width: 3;
    }
    g[data-mml-node="xypic"] path {
    stroke-width: inherit;
    }
    .MathJax g[data-mml-node="xypic"] path {
    stroke-width: inherit;
    }
    }"
  `);
});

const rule = (selector: string): string => {
  const start = mathJaxCss.indexOf(`\n${selector} {`);
  return start < 0
    ? ""
    : mathJaxCss.slice(start, mathJaxCss.indexOf("}", start));
};

it("keys every rule on MathJax's container, so none reach other content", () => {
  const selectors = [
    ...mathJaxCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g),
  ].flatMap((match) => (match[1] ?? "").split(",").map((part) => part.trim()));
  expect(selectors.length).toBeGreaterThan(10);
  for (const selector of selectors) {
    expect(
      selector.startsWith('mjx-container[jax="SVG"]') ||
        selector === 'span:has(> mjx-container[jax="SVG"])'
    ).toBe(true);
  }
});

it("keeps assistive MathML clipped and SVG paint inside its box", () => {
  // The container is the containing block for the absolutely positioned
  // assistive MathML; inline `position` is not admitted, so the sheet sets it.
  expect(rule('mjx-container[jax="SVG"]')).toContain("position: relative");
  const assistive = rule('mjx-container[jax="SVG"] mjx-assistive-mml');
  expect(assistive).toContain("clip: rect(1px, 1px, 1px, 1px) !important");
  expect(assistive).toContain("position: absolute !important");
  expect(assistive).toContain("padding: 1px 0px 0px !important");
  // MathJax's sheet says `overflow: visible`; a forged wrapper could then draw
  // a 1x1 SVG's shapes across the viewer, so the viewer sheet clips with a
  // margin wide enough for glyph overhang.
  const svg = rule('mjx-container[jax="SVG"] > svg');
  expect(svg).toContain("overflow: clip");
  expect(svg).toContain("overflow-clip-margin: 1em");
  expect(rule('mjx-container[jax="SVG"] > svg a')).toContain("fill: blue");
  expect(rule('mjx-container[jax="SVG"][display="true"]')).toContain(
    "margin: 1em 0px"
  );
  // mjx-status is fixed-positioned in MathJax's default sheet; nothing in
  // rendered output uses it and fixed positioning is not admitted.
  expect(mathJaxCss).not.toMatch(/fixed|mjx-tool|mjx-tip|mjx-status|url\(/);
});
