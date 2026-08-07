// @vitest-environment jsdom
import * as fs from "node:fs";

import { afterAll, expect, it } from "vitest";

import { renderMarkdown } from "./markdownRendering";
import { sanitizeRenderedHtml } from "./renderedHtmlSanitizer";

const lines: string[] = [];
afterAll(() => {
  fs.writeFileSync("/tmp/zzscratch-exp.txt", lines.join("\n"));
});

const CSS = `#mjx-aa{}body{background-image:image-set('https://evil.example/x.png' 1x)}`;
const CSS2 = `#mjx-aa{}body{background:u\\rl(https://evil.example/y.png)}`;
const CSS3 = `#mjx-aa{}@\\69 mport 'https://evil.example/z.css';`;
const CSS4 = `#mjx-aa{}@font-face{font-family:E;src:u\\rl(https://evil.example/f.woff2)}body{font-family:E}`;

const inj = (payload: string) => `$\\href{x">${payload}<b z="}{z}$`;

const CASES: Array<[string, string]> = [
  ["direct-span-style", inj(`<span id="mjx-aa"><style>${CSS}</style></span>`)],
  [
    "closesvg-span-style",
    inj(`</svg><span id="mjx-aa"><style>${CSS}</style></span>`),
  ],
  [
    "closeall-span-style",
    inj(`</svg></mjx-container><span id="mjx-aa"><style>${CSS}</style></span>`),
  ],
  [
    "escaped-url",
    inj(`</svg><span id="mjx-aa"><style>${CSS2}</style></span>`),
  ],
  ["import", inj(`</svg><span id="mjx-aa"><style>${CSS3}</style></span>`)],
  ["font-face", inj(`</svg><span id="mjx-aa"><style>${CSS4}</style></span>`)],
];

for (const [name, md] of CASES) {
  it(name, async () => {
    const rendered = await renderMarkdown(md, "full");
    const out = sanitizeRenderedHtml(rendered);
    const i = out.indexOf("</style>");
    const tail = i >= 0 ? out.slice(i) : out;
    lines.push(
      `=== ${name} ===\nMD  : ${md}\nTAIL: ${tail.slice(0, 1200)}\nHAS_EVIL_IN_SANITIZED: ${out.includes("evil.example")}\n`
    );
    expect(true).toBe(true);
  });
}
