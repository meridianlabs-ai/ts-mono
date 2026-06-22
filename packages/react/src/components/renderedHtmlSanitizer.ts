const FORBIDDEN_ELEMENTS = new Set([
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
  "input",
  "link",
  "meta",
  "mpath",
  "object",
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
  /@import|behavior\s*:|binding\s*:|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|url\s*\(/i;

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

  if (typeof document === "undefined") {
    return escapeHtmlCharacters(html);
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeChildren(template.content);
  return template.innerHTML;
};

const sanitizeChildren = (parent: ParentNode): void => {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const element = child as Element;
    const tagName = element.tagName.toLowerCase();

    if (FORBIDDEN_ELEMENTS.has(tagName)) {
      element.remove();
      continue;
    }

    if (tagName === "style" && !isAllowedStyleElement(element)) {
      element.remove();
      continue;
    }

    sanitizeAttributes(element);
    sanitizeChildren(element);
  }
};

const sanitizeAttributes = (element: Element): void => {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith("on") || name === "srcdoc" || name === "srcset") {
      element.removeAttribute(attr.name);
      continue;
    }

    if (name === "style") {
      const safeStyle = sanitizeStyleAttribute(value);
      if (safeStyle) {
        element.setAttribute(attr.name, safeStyle);
      } else {
        element.removeAttribute(attr.name);
      }
      continue;
    }

    if (URL_ATTRIBUTES.has(name) && !isSafeUrl(value)) {
      element.removeAttribute(attr.name);
    }
  }
};

const isSafeUrl = (value: string): boolean => {
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
  if (/^(?:javascript|vbscript|data):/i.test(normalized)) {
    return false;
  }

  if (normalized.startsWith("#")) {
    return true;
  }

  const explicitProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.exec(normalized);
  if (!explicitProtocol) {
    return true;
  }

  try {
    const parsed = new URL(
      normalized,
      document.baseURI || "https://example.invalid/"
    );
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
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

const isAllowedStyleElement = (element: Element): boolean => {
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
