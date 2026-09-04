import createDOMPurify, {
  type Config,
  type DOMPurify as DOMPurifyInstance,
  type UponSanitizeAttributeHookEvent,
} from "dompurify";

import { canonicalImageSource } from "@tsmono/util";

const FORBIDDEN_TAGS = [
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
];

const MATHJAX_TAGS = [
  "mjx-assistive-mml",
  "mjx-container",
  "mjx-status",
  "mjx-tip",
  "mjx-tool",
  "style",
];

const MATHJAX_ATTRS = [
  "display",
  "focusable",
  "jax",
  "justify",
  "role",
  "unselectable",
  "width",
];

const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "formaction",
  "href",
  "poster",
  "src",
  "xlink:href",
]);

// Browsers enumerate a parsed shorthand as its longhands (jsdom lists both),
// so each allowlist below names the longhands too.
const BOX_EDGES = ["top", "right", "bottom", "left"];
const BOX_LONGHANDS = [
  "overflow-x",
  "overflow-y",
  ...BOX_EDGES.flatMap((edge) => [
    `margin-${edge}`,
    `padding-${edge}`,
    `border-${edge}-color`,
    `border-${edge}-style`,
    `border-${edge}-width`,
  ]),
];

// Inline styles reach the sanitizer from log content (TeX \style{}, any
// raw-HTML producer), so they may not take an element out of normal flow or
// paint beyond its box: no insets, no box-shadow, and isSafeStyleValue further
// limits `position` and `margin`.
const INLINE_STYLE_PROPERTIES = new Set([
  ...BOX_LONGHANDS,
  "-khtml-user-select",
  "-moz-user-select",
  "-ms-user-select",
  "-webkit-touch-callout",
  "-webkit-user-select",
  "background-color",
  "border",
  "clip",
  "color",
  "direction",
  "display",
  "fill",
  "font-family",
  "font-size",
  "height",
  "line-height",
  "margin",
  "min-height",
  "min-width",
  "overflow",
  "padding",
  "position",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-width",
  "text-align",
  "user-select",
  "vertical-align",
  "width",
]);

// MathJax's per-formula stylesheet is nested under the formula's own id, so it
// may additionally absolutely position its assistive MathML and tooltips.
const MATHJAX_STYLESHEET_PROPERTIES = new Set([
  ...INLINE_STYLE_PROPERTIES,
  "bottom",
  "box-shadow",
  "cursor",
  "left",
  "right",
  "top",
]);

type StyleScope = "inline" | "mathjax-stylesheet";

const POSITION_VALUES: Record<StyleScope, Set<string>> = {
  inline: new Set(["static", "relative"]),
  "mathjax-stylesheet": new Set(["static", "relative", "absolute"]),
};

// Any other function (url, image-set, image, src, expression, ...) can load a
// resource or run code; allowlisting is what makes escape spellings moot.
const SAFE_CSS_FUNCTIONS = new Set(["hsl", "hsla", "rect", "rgb", "rgba"]);

const UNSAFE_CSS_PATTERN =
  /@import|behavior\s*:|binding\s*:|expression\s*\(|javascript\s*:|vbscript\s*:|url\s*\(/i;

// Backslashes are CSS escapes the tokenizer decodes but a text match does not
// (`\75rl(` is `url(`); `@` starts an at-rule; `<` is markup. MathJax emits none.
const RAW_CSS_REJECT_PATTERN = /[\\@<]/;

const MATHJAX_WRAPPER_ID = /^mjx-[a-f0-9]+$/i;

const PURIFY_CONFIG: Config = {
  ADD_ATTR: [...MATHJAX_ATTRS, "target"],
  // Redundant today — `img` is already in DOMPurify's DEFAULT_DATA_URI_TAGS —
  // but stated explicitly so a change to that default cannot silently break
  // inline images. It grants no safety of its own: `safeImgSrc` is the gate.
  ADD_DATA_URI_TAGS: ["img"],
  ADD_TAGS: MATHJAX_TAGS,
  ALLOW_DATA_ATTR: true,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_ATTR: ["srcdoc", "srcset"],
  FORBID_TAGS: FORBIDDEN_TAGS,
  USE_PROFILES: { html: true, mathMl: true, svg: true },
};

let purify: DOMPurifyInstance | undefined;
let hooksInstalled = false;

const escapeHtmlCharacters = (content: string): string =>
  content.replace(/[<>&'"]/g, (c: string): string => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });

export const sanitizeRenderedHtml = (html: string): string => {
  if (!html) {
    return html;
  }

  const purifier = getPurify();
  if (!purifier) {
    return escapeHtmlCharacters(html);
  }

  return purifier.sanitize(html, PURIFY_CONFIG);
};

const getPurify = (): DOMPurifyInstance | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!purify) {
    purify = createDOMPurify(window);
  }

  installHooks(purify);
  return purify;
};

const installHooks = (purify: DOMPurifyInstance): void => {
  if (hooksInstalled) {
    return;
  }
  hooksInstalled = true;

  purify.addHook("uponSanitizeElement", (node, hookEvent) => {
    if (hookEvent.tagName !== "style" || !(node instanceof Element)) {
      return;
    }
    const css = sanitizeMathJaxStyleElement(node);
    if (css) {
      node.textContent = css;
    } else {
      node.remove();
    }
  });

  purify.addHook("uponSanitizeAttribute", (node, hookEvent) => {
    if (hookEvent.attrName === "style") {
      sanitizeStyleAttributeHook(node, hookEvent);
      return;
    }

    if (hookEvent.attrName === "src" && isImgElement(node)) {
      const canonical = safeImgSrc(hookEvent.attrValue);
      if (canonical === undefined) {
        hookEvent.keepAttr = false;
        node.removeAttribute(hookEvent.attrName);
      } else {
        hookEvent.attrValue = canonical;
      }
      return;
    }

    if (
      URL_ATTRIBUTES.has(hookEvent.attrName) &&
      !isSafeUrlAttribute(hookEvent.attrValue)
    ) {
      hookEvent.keepAttr = false;
      node.removeAttribute(hookEvent.attrName);
    }
  });

  purify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) {
      return;
    }

    // Catches every route to a src-less img — rejected above, stripped by
    // DOMPurify's own checks, or never present — all of which would otherwise
    // ship a broken-image placeholder.
    if (isImgElement(node)) {
      if (safeImgSrc(node.getAttribute("src") ?? "") === undefined) {
        node.remove();
      }
      return;
    }

    if (
      node.tagName.toLowerCase() === "a" &&
      node.getAttribute("target")?.toLowerCase() === "_blank"
    ) {
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
};

const sanitizeStyleAttributeHook = (
  node: Element,
  hookEvent: UponSanitizeAttributeHookEvent
): void => {
  const safeStyle = sanitizeStyleAttribute(hookEvent.attrValue);
  if (safeStyle) {
    hookEvent.attrValue = safeStyle;
  } else {
    hookEvent.keepAttr = false;
    node.removeAttribute(hookEvent.attrName);
  }
};

const isImgElement = (node: Element): boolean =>
  node.tagName.toLowerCase() === "img";

/**
 * A remote src is not unsafe by protocol, but fetching it leaks a request to an
 * attacker-chosen host, so an img src is limited to inline raster data.
 *
 * Returns the value to keep, so the attribute that lands in the DOM is the one
 * that was validated.
 */
const safeImgSrc = (value: string): string | undefined => {
  if (/[<>"'`]/.test(value.trim())) {
    return undefined;
  }
  return canonicalImageSource(value);
};

const isSafeUrlAttribute = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  if (/[<>"'`]/.test(trimmed)) {
    return false;
  }

  const normalized = Array.from(trimmed)
    .filter((char) => {
      const charCode = char.charCodeAt(0);
      return charCode > 0x1f && charCode !== 0x7f && !/\s/.test(char);
    })
    .join("");

  if (/^data:/i.test(normalized)) {
    return false;
  }

  return !/^(?:javascript|vbscript):/i.test(normalized);
};

const sanitizeStyleAttribute = (style: string): string => {
  if (
    !style ||
    UNSAFE_CSS_PATTERN.test(style) ||
    RAW_CSS_REJECT_PATTERN.test(style)
  ) {
    return "";
  }

  const scratch = document.createElement("span");
  scratch.setAttribute("style", style);
  return safeDeclarations(
    scratch.style,
    INLINE_STYLE_PROPERTIES,
    "inline"
  ).join(" ");
};

const safeDeclarations = (
  style: CSSStyleDeclaration,
  allowedProperties: Set<string>,
  scope: StyleScope
): string[] => {
  const declarations: string[] = [];
  for (const property of Array.from(style)) {
    const normalizedProperty = property.toLowerCase();
    const value = style.getPropertyValue(property);
    if (
      !allowedProperties.has(normalizedProperty) ||
      !value ||
      !isSafeStyleValue(normalizedProperty, value, scope)
    ) {
      continue;
    }
    const priority = style.getPropertyPriority(property);
    declarations.push(
      `${normalizedProperty}: ${value}${priority ? ` !${priority}` : ""};`
    );
  }
  return declarations;
};

const isSafeStyleValue = (
  property: string,
  value: string,
  scope: StyleScope
): boolean => {
  if (UNSAFE_CSS_PATTERN.test(value) || RAW_CSS_REJECT_PATTERN.test(value)) {
    return false;
  }
  for (const call of value.matchAll(/([-\w]*)\s*\(/g)) {
    if (!SAFE_CSS_FUNCTIONS.has((call[1] ?? "").toLowerCase())) {
      return false;
    }
  }
  if (property === "position") {
    return POSITION_VALUES[scope].has(value);
  }
  // A negative margin pulls the box over neighbouring content while staying
  // in normal flow, which the position policy above would otherwise prevent.
  if (property.startsWith("margin") && /(?:^|\s)-/.test(value)) {
    return false;
  }
  return true;
};

/**
 * markdown-it-mathjax3 wraps each formula in `<span id="mjx-…">` whose first
 * child is a `<style>` carrying MathJax's stylesheet nested under that id.
 * That is the only stylesheet rendered content may contribute, so rather than
 * trusting the text the CSS is parsed and rebuilt: only style rules survive,
 * every rule stays nested under the wrapper's id, and declarations pass the
 * same allowlist as inline styles. Returns the CSS to keep, or "" to drop the
 * element.
 */
const sanitizeMathJaxStyleElement = (element: Element): string => {
  const parent = element.parentElement;
  const scopeId = parent?.getAttribute("id") ?? "";
  if (
    parent?.tagName.toLowerCase() !== "span" ||
    !MATHJAX_WRAPPER_ID.test(scopeId)
  ) {
    return "";
  }
  return sanitizeScopedStyleSheet(element.textContent, scopeId);
};

const sanitizeScopedStyleSheet = (css: string, scopeId: string): string => {
  if (
    !css ||
    UNSAFE_CSS_PATTERN.test(css) ||
    RAW_CSS_REJECT_PATTERN.test(css)
  ) {
    return "";
  }

  // A constructed sheet is never attached to a document, so parsing it loads
  // nothing; older engines without it (or without CSSOM nesting) fail closed.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const rules: string[] = [];
    for (const rule of Array.from(sheet.cssRules)) {
      if (
        !(rule instanceof CSSStyleRule) ||
        rule.selectorText !== `#${scopeId}`
      ) {
        continue;
      }
      const body = [
        ...safeDeclarations(
          rule.style,
          MATHJAX_STYLESHEET_PROPERTIES,
          "mathjax-stylesheet"
        ),
        ...safeNestedRules(rule),
      ];
      if (body.length > 0) {
        rules.push(`#${scopeId} { ${body.join(" ")} }`);
      }
    }
    return rules.join(" ");
  } catch {
    return "";
  }
};

const safeNestedRules = (parent: CSSStyleRule): string[] => {
  const rules: string[] = [];
  for (const rule of Array.from(parent.cssRules)) {
    if (!(rule instanceof CSSStyleRule)) {
      continue;
    }
    const selector = anchoredNestedSelector(rule.selectorText);
    const declarations = safeDeclarations(
      rule.style,
      MATHJAX_STYLESHEET_PROPERTIES,
      "mathjax-stylesheet"
    );
    if (selector && declarations.length > 0) {
      rules.push(`${selector} { ${declarations.join(" ")} }`);
    }
  }
  return rules;
};

// A nested selector only stays inside its parent's scope while `&` is the
// leading token: `body &` and `:is(body, &)` match outside it. Each selector
// in the list is re-anchored with a leading `&` (engines serialize the
// implicit one differently) and rejected if another `&` or a functional
// pseudo-class remains.
const anchoredNestedSelector = (selectorText: string): string | undefined => {
  const anchored: string[] = [];
  for (const part of selectorText.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      return undefined;
    }
    const selector = trimmed.startsWith("&") ? trimmed : `& ${trimmed}`;
    if (/[&(]/.test(selector.slice(1))) {
      return undefined;
    }
    anchored.push(selector);
  }
  return anchored.join(", ");
};
