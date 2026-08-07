import createDOMPurify, {
  type Config,
  type DOMPurify as DOMPurifyInstance,
  type UponSanitizeAttributeHookEvent,
} from "dompurify";

import { isRenderableImageSource } from "@tsmono/util";

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

const SAFE_STYLE_PROPERTIES = new Set([
  "-khtml-user-select",
  "-moz-user-select",
  "-ms-user-select",
  "-webkit-touch-callout",
  "-webkit-user-select",
  "background-color",
  "border",
  "bottom",
  "box-shadow",
  "clip",
  "color",
  "direction",
  "display",
  "fill",
  "font-family",
  "font-size",
  "height",
  "left",
  "line-height",
  "margin",
  "min-height",
  "min-width",
  "overflow",
  "padding",
  "position",
  "right",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-width",
  "text-align",
  "top",
  "user-select",
  "vertical-align",
  "width",
]);

const UNSAFE_CSS_PATTERN =
  /@import|behavior\s*:|binding\s*:|expression\s*\(|javascript\s*:|vbscript\s*:|url\s*\(/i;

const PURIFY_CONFIG: Config = {
  ADD_ATTR: [...MATHJAX_ATTRS, "target"],
  // `img` is not in FORBIDDEN_TAGS, but every src is still gated on
  // isRenderableImageSource below, so only inline raster data survives.
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
    if (
      hookEvent.tagName === "style" &&
      node instanceof Element &&
      !isAllowedMathJaxStyleElement(node)
    ) {
      node.remove();
    }
  });

  purify.addHook("uponSanitizeAttribute", (node, hookEvent) => {
    if (hookEvent.attrName === "style") {
      sanitizeStyleAttributeHook(node, hookEvent);
    } else if (
      URL_ATTRIBUTES.has(hookEvent.attrName) &&
      !isSafeUrlAttribute(node, hookEvent.attrName, hookEvent.attrValue)
    ) {
      hookEvent.keepAttr = false;
      node.removeAttribute(hookEvent.attrName);
      // A src-less img is a broken-image placeholder, so remove the element.
      if (node.tagName.toLowerCase() === "img") {
        node.remove();
      }
    }
  });

  purify.addHook("afterSanitizeAttributes", (node) => {
    if (
      node instanceof Element &&
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

const isSafeUrlAttribute = (
  node: Element,
  attrName: string,
  value: string
): boolean => {
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

  // Must precede the generic checks: a remote src is not unsafe by protocol,
  // but loading it leaks a fetch to an attacker-controlled host, so an img src
  // is allowed only when it is inline raster data that needs no request.
  if (attrName === "src" && node.tagName.toLowerCase() === "img") {
    return isRenderableImageSource(normalized);
  }

  if (/^data:/i.test(normalized)) {
    return false;
  }

  return !/^(?:javascript|vbscript):/i.test(normalized);
};

const sanitizeStyleAttribute = (style: string): string => {
  if (!style || UNSAFE_CSS_PATTERN.test(style)) {
    return "";
  }

  const scratch = document.createElement("span");
  scratch.setAttribute("style", style);

  const safeDeclarations: string[] = [];
  for (const property of Array.from(scratch.style)) {
    const normalizedProperty = property.toLowerCase();
    const value = scratch.style.getPropertyValue(property);

    if (
      SAFE_STYLE_PROPERTIES.has(normalizedProperty) &&
      value &&
      !UNSAFE_CSS_PATTERN.test(value)
    ) {
      const priority = scratch.style.getPropertyPriority(property);
      safeDeclarations.push(
        `${normalizedProperty}: ${value}${priority ? ` !${priority}` : ""};`
      );
    }
  }

  return safeDeclarations.join(" ");
};

const isAllowedMathJaxStyleElement = (element: Element): boolean => {
  const parent = element.parentElement;
  const parentId = parent?.getAttribute("id") || "";
  const css = element.textContent || "";

  return (
    parent?.tagName.toLowerCase() === "span" &&
    /^mjx-[a-f0-9]+$/i.test(parentId) &&
    css.includes(`#${parentId}`) &&
    !UNSAFE_CSS_PATTERN.test(css)
  );
};
