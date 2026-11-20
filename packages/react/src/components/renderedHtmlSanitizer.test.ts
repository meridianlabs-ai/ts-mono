// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdownRendering";
import { sanitizeRenderedHtml } from "./renderedHtmlSanitizer";

const parse = (html: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

const mathJaxWrapper = (css: string, id = "mjx-a1"): string =>
  `<span id="${id}"><style>${css}</style><mjx-container jax="SVG">x</mjx-container></span>`;

describe("sanitizeRenderedHtml MathJax output", () => {
  let mathHtml = "";
  beforeAll(async () => {
    mathHtml = await renderMarkdown("$\\frac{1}{2}$", "full");
  });

  // The rules MathJax ships inline come from the viewer's mathjax.css (see
  // mathjax.test.ts), so no <style> survives, genuine or forged.
  it("keeps rendered math and its accessible MathML without a style element", () => {
    const root = parse(sanitizeRenderedHtml(mathHtml));
    expect(root.querySelector("mjx-container svg")).not.toBeNull();
    expect(root.querySelector("mjx-assistive-mml math")).not.toBeNull();
    expect(root.querySelector("style")).toBeNull();
  });

  it.each([
    ["an empty sheet", ""],
    [
      "an unscoped rule",
      "#mjx-a1{display:contents} body{background-color:red}",
    ],
    ["a sibling selector", "#mjx-a1 { & + #outside { color: red } }"],
    [
      "an overlay",
      "#mjx-a1 { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; box-shadow: 0 0 0 9999px white }",
    ],
    [
      "a CSS-escaped url()",
      "#mjx-a1{ & div { fill: \\75rl(https://attacker.example/x) } }",
    ],
    [
      "a CSS-escaped @import",
      '@\\69mport "https://attacker.example/x.css"; #mjx-a1{}',
    ],
    ["a literal @import", "@import url(https://attacker.example/x.css);"],
    [
      "a literal url()",
      "#mjx-a1{ & div { fill: url(https://attacker.example/x) } }",
    ],
    ["not css", "not css"],
  ])("drops a MathJax-shaped style element carrying %s", (_label, css) => {
    const html = sanitizeRenderedHtml(mathJaxWrapper(css));
    const root = parse(html);
    expect(root.querySelector("style")).toBeNull();
    expect(root.querySelector("mjx-container")).not.toBeNull();
    expect(html).not.toMatch(/attacker|url\(|@import|100vw|9999px|#outside/);
  });

  it.each(["mjx-x1", "mjx-a1,body", "mjx-a1 body", "mjx-a1{color:red}"])(
    "drops the style element under an invalid wrapper id: %s",
    (id) => {
      const root = parse(sanitizeRenderedHtml(mathJaxWrapper("body{}", id)));
      expect(root.querySelector("style")).toBeNull();
    }
  );

  it("drops a style element outside any MathJax wrapper", () => {
    const root = parse(
      sanitizeRenderedHtml("<div><style>#x{color:red}</style>x</div>")
    );
    expect(root.querySelector("style")).toBeNull();
  });

  it("clips assistive MathML even when its author supplies an inline override", () => {
    const root = parse(
      sanitizeRenderedHtml(
        '<span id="mjx-a1"><mjx-assistive-mml style="clip: auto !important; overflow: visible !important; width: 100vw !important; height: 100vh !important"><math><mtext>accessible math</mtext></math></mjx-assistive-mml></span>'
      )
    );
    const assistive = root.querySelector("mjx-assistive-mml");
    expect(assistive?.querySelector("math")?.textContent).toBe(
      "accessible math"
    );
    // Inline !important would beat the stylesheet's clipping rule.
    expect(assistive?.hasAttribute("style")).toBe(false);
  });

  it("does not admit forged runtime tooltip elements into static math output", () => {
    const root = parse(
      sanitizeRenderedHtml(
        '<span id="mjx-a1"><mjx-container jax="SVG"><mjx-tool><mjx-tip><div style="width:100vw;height:100vh;background-color:red">overlay</div></mjx-tip></mjx-tool></mjx-container></span>'
      )
    );
    expect(root.querySelector("mjx-tool, mjx-tip")).toBeNull();
  });

  it("keeps the native SVG tooltip and accessible MathML of rendered math", async () => {
    const html = await renderMarkdown(
      "$\\mathtip{x^2}{\\text{square}}$",
      "full"
    );
    const root = parse(sanitizeRenderedHtml(html));
    expect(root.querySelector("svg title")?.textContent).toBe("square");
    expect(root.querySelector("mjx-assistive-mml math")).not.toBeNull();
  });
});

describe("sanitizeRenderedHtml SVG overflow", () => {
  it("drops the overflow presentation attribute", () => {
    const svg = parse(
      sanitizeRenderedHtml(
        '<svg overflow="visible" width="1" height="1"><rect x="-9999" y="-9999" width="99999" height="99999"></rect></svg>'
      )
    ).querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.hasAttribute("overflow")).toBe(false);
  });
});

// Each of these fetches its URL as soon as the element renders, with no click.
describe("sanitizeRenderedHtml fetching attributes", () => {
  const remote = "https://attacker.example/x.svg#x";

  it("drops background from table cells and keeps the table", () => {
    const root = parse(
      sanitizeRenderedHtml(
        `<table background="${remote}"><tr><th background="${remote}">h</th><td background="${remote}">d</td></tr></table>`
      )
    );
    expect(root.querySelectorAll("table, th, td")).toHaveLength(3);
    expect(root.querySelector("[background]")).toBeNull();
  });

  it.each([
    ["fill", `url(${remote})`],
    ["stroke", `url('${remote}')`],
    ["filter", `url(${remote})`],
    ["mask", `URL( ${remote} )`],
    ["clip-path", `url(${remote})`],
    ["marker-start", `url(${remote})`],
    ["marker-mid", `url(${remote})`],
    ["marker-end", `url(${remote})`],
    ["fill", `url(#ok) url(${remote})`],
    ["fill", `\\75rl(${remote})`],
    ["mask", `image-set('${remote}' 1x)`],
    ["mask", `-webkit-image-set('${remote}' 1x)`],
  ])("drops %s=%s", (attribute, value) => {
    const rect = parse(
      sanitizeRenderedHtml(`<svg><rect ${attribute}="${value}"></rect></svg>`)
    ).querySelector("rect");
    expect(rect).not.toBeNull();
    expect(rect?.hasAttribute(attribute)).toBe(false);
  });

  it("keeps colours and same-document references", () => {
    const rect = parse(
      sanitizeRenderedHtml(
        `<svg><rect fill="url(#gradient)" stroke="rgb(255, 0, 0)" mask="url('#m')" clip-path="none"></rect></svg>`
      )
    ).querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("url(#gradient)");
    expect(rect?.getAttribute("stroke")).toBe("rgb(255, 0, 0)");
    expect(rect?.getAttribute("mask")).toBe("url('#m')");
    expect(rect?.getAttribute("clip-path")).toBe("none");
  });

  it.each([
    ["pattern", "href"],
    ["linearGradient", "href"],
    ["textPath", "xlink:href"],
  ])("drops a remote %s %s", (tag, attribute) => {
    const element = parse(
      sanitizeRenderedHtml(
        `<svg><${tag} ${attribute}="${remote}"></${tag}></svg>`
      )
    ).querySelector(tag);
    expect(element).not.toBeNull();
    expect(element?.hasAttribute(attribute)).toBe(false);
  });

  it("keeps same-document SVG references and link hrefs", () => {
    const root = parse(
      sanitizeRenderedHtml(
        `<svg><pattern id="p" href="#q"></pattern><a href="https://example.com/">x</a></svg>`
      )
    );
    expect(root.querySelector("pattern")?.getAttribute("href")).toBe("#q");
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/"
    );
  });

  it("drops src from MathML's mglyph", () => {
    const glyph = parse(
      sanitizeRenderedHtml(
        `<math><mglyph src="${remote}" alt="g"></mglyph></math>`
      )
    ).querySelector("mglyph");
    expect(glyph).not.toBeNull();
    expect(glyph?.hasAttribute("src")).toBe(false);
  });
});

describe("sanitizeRenderedHtml inline style attributes", () => {
  const styleOf = (style: string): string =>
    parse(sanitizeRenderedHtml(`<div style="${style}">x</div>`))
      .querySelector("div")
      ?.getAttribute("style") ?? "";

  it("keeps the declarations MathJax puts on its output, except position", () => {
    const kept = styleOf(
      "position: relative; min-width: 14.823ex; vertical-align: -0.566ex; color: red"
    );
    expect(kept).not.toContain("position");
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
    // A relatively positioned box paints above normal-flow text, so inside a
    // zero-height parent it covers whatever follows it.
    [
      "relative positioning in a zero-height parent",
      "position: relative; height: 100vh; width: 100vw; background-color: #fff",
      /position/,
    ],
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
    // `visible` is the default; writing it inline only undoes a clip.
    ["overflow: visible", "overflow: visible", /overflow/],
    ["overflow-y: visible", "overflow-y: visible; overflow-x: auto", /visible/],
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
