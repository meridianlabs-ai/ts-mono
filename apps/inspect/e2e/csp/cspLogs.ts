import {
  testAssistantMessage,
  testStoreEvent,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { EvalLog } from "@tsmono/inspect-common/types";

import { createEvalLog, createEvalSample } from "../fixtures/test-data";

import { kMp4DataUri, kWavDataUri } from "./media";

export const kProbeHost = "probe.csp.test";
const probe = (path: string): string => `https://${kProbeHost}/${path}`;

export const kTerminalText = "csp-terminal-ok";

// Pushes the log response past the JSON parser's 50k-char worker threshold,
// so the app's JSON parse worker runs.
const kWorkerPadding = "padding ".repeat(8_000);

const kBrokenPngDataUri = "data:image/png;base64,AAAA";

// A `script -T` recording: header line, then the bytes the timing file meters.
const terminalHeader =
  'Script started on 2026-01-01 00:00:00+00:00 [COLUMNS="40" LINES="6"]\n';
const terminalOutput = `${terminalHeader}${kTerminalText}\r\n`;

/** Media and a human-baseline terminal, big enough for the JSON worker. */
export const mainLog: EvalLog = createEvalLog({
  samples: [
    createEvalSample({
      id: "media",
      metadata: { padding: kWorkerPadding },
      messages: [
        testUserMessage({
          content: [
            { type: "text", text: "Describe these." },
            { type: "audio", audio: kWavDataUri, format: "wav" },
            { type: "video", video: kMp4DataUri, format: "mp4" },
          ],
        }),
        testAssistantMessage({ content: "Heard and seen." }),
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

// Markdown entity-escapes raw HTML, so markup can only reach the sanitizer
// through MathJax. Its serializer used to leave some attributes and <title>
// text unescaped, so these TeX routes let a formula end one and write markup.
// The pipeline now escapes both; each vector would fetch or run script if a
// route reopened and the sanitizer missed it.
const kOutOfTitle = "</title></g></g></g></svg>";
const kRoutes = {
  href: (markup: string) => `$\\href{x">${markup}}{z}$`,
  mmlToken: (markup: string) => `$\\mmlToken{mi}[href='x">${markup}']{x}$`,
  texttip: (markup: string) => `$\\texttip{z}{${kOutOfTitle}${markup}}$`,
  texError: (markup: string) => `$\\begin{${kOutOfTitle}${markup}}x\\end{y}$`,
};

const svgPaint = (attribute: string): string =>
  `<svg width="9" height="9"><path d="M0 0L9 9H0Z" ${attribute}="url(${probe(attribute)}.svg#x)"></path></svg>`;

const kTableBackground = `<table background="${probe("table")}"><tr><td>table</td></tr></table>`;

const kVectors = [
  kTableBackground,
  `<table><tr><td background="${probe("td")}">td</td></tr></table>`,
  `<img src="${probe("img")}">`,
  // A src the sanitizer keeps (inline raster data) that fails to decode, so
  // the handler fires if it survives.
  `<img src="${kBrokenPngDataUri}" onerror="fetch('${probe("onerror")}')">`,
  `<svg onload="fetch('${probe("svg-onload")}')"></svg>`,
  `<a href="javascript:fetch('${probe("javascript")}')">js link</a>`,
  `<div style="background-image: url(${probe("css-url")})">css url</div>`,
  `<svg><image href="${probe("svg-image")}"></image></svg>`,
  `<video poster="${probe("poster")}"></video>`,
  ...["fill", "stroke", "filter", "mask", "clip-path", "marker-start"].map(
    svgPaint
  ),
];

const kFormulas = [
  ...kVectors.map(kRoutes.href),
  kRoutes.mmlToken(kTableBackground),
  kRoutes.texttip(kTableBackground),
  kRoutes.texError(kTableBackground),
];

export const kCanaryFormulaCount = kFormulas.length;

/** Rendering vectors that must neither run script nor reach the probe host. */
export const kCanaryMarkdown = [
  ...kFormulas,
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
