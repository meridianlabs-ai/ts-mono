import {
  testAssistantMessage,
  testStoreEvent,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { EvalLog } from "@tsmono/inspect-common/types";

import { createEvalLog, createEvalSample } from "../fixtures/test-data";

import { kMp4DataUri, kPngDataUri, kWavDataUri } from "./media";

export const kProbeHost = "probe.csp.test";
const probe = (path: string): string => `https://${kProbeHost}/${path}`;

export const kTerminalText = "csp-terminal-ok";

// A `script -T` recording: header line, then the bytes the timing file meters.
const terminalHeader =
  'Script started on 2026-01-01 00:00:00+00:00 [COLUMNS="40" LINES="6"]\n';
const terminalOutput = `${terminalHeader}${kTerminalText}\r\n`;

/** The main flows: markdown with math, media, and a human-baseline terminal. */
export const mainLog: EvalLog = createEvalLog({
  samples: [
    createEvalSample({
      id: "media",
      messages: [
        testUserMessage({
          content: [
            { type: "text", text: "Describe these." },
            { type: "image", image: kPngDataUri, detail: "auto" },
            { type: "audio", audio: kWavDataUri, format: "wav" },
            { type: "video", video: kMp4DataUri, format: "mp4" },
          ],
        }),
        testAssistantMessage({
          content: [
            "Inline $x^2 + \\href{https://example.com/}{y}$ and display:",
            "$$\\frac{1}{2} = \\sum_{n=1}^{\\infty} 2^{-n-1} \\cdot 2$$",
          ].join("\n\n"),
        }),
      ],
    }),
    createEvalSample({
      id: "terminal",
      messages: [
        testUserMessage({ content: "Run the session." }),
        testAssistantMessage({ content: "Done." }),
      ],
      events: [
        testStoreEvent({
          changes: [
            {
              op: "add",
              path: "/HumanAgentState:logs",
              value: {
                "user_1700000000_000001.input": terminalHeader,
                "user_1700000000_000001.output": terminalOutput,
                "user_1700000000_000001.timing": `O 0.05 ${terminalOutput.length - terminalHeader.length}\n`,
              },
              replaced: null,
            },
            {
              op: "add",
              path: "/HumanAgentState:answer",
              value: "done",
              replaced: null,
            },
          ],
        }),
      ],
    }),
  ],
});

// Markdown entity-escapes raw HTML, so markup reaches the sanitizer through
// MathJax: `\href` emits its URL unescaped into the SVG, which lets a formula
// break out of the attribute. That breakout, carrying a `<table background>`,
// is the sanitizer bug this policy backstops; the other vectors ride the
// same route.
const breakout = (markup: string): string => `$\\href{x">${markup}}{z}$`;

/** Rendering vectors that must neither run script nor reach the probe host. */
export const kCanaryMarkdown = [
  breakout(
    `<table background="${probe("table")}"><tr><td>table</td></tr></table>`
  ),
  breakout(`<img src="${probe("img")}">`),
  breakout(`<img src="x" onerror="fetch('${probe("onerror")}')">`),
  breakout(`<svg onload="fetch('${probe("svg-onload")}')"></svg>`),
  breakout(`<a href="javascript:fetch('${probe("javascript")}')">js link</a>`),
  breakout(
    `<div style="background-image: url(${probe("css-url")})">css url</div>`
  ),
  breakout(`<svg><image href="${probe("svg-image")}"></image></svg>`),
  breakout(`<video poster="${probe("poster")}"></video>`),
  `![remote](${probe("markdown.png")})`,
].join("\n\n");

export const canaryLog: EvalLog = createEvalLog({
  samples: [
    createEvalSample({
      id: "canary",
      messages: [
        testUserMessage({ content: "Render the vectors." }),
        testAssistantMessage({ content: kCanaryMarkdown }),
      ],
    }),
  ],
});
