# Rendered content and media

Shared rich rendering used by Messages, transcript events, metadata, tool
cards, and scan references: markdown/code/math, structured content arrays,
record trees, citations, tool inputs/outputs, ANSI, images, documents, and
safe treatment of remote media.

## Sub-features

- `markdown-code-math` renders prose, whitespace, links, fenced code, syntax
  highlighting, and MathJax without exposing raw markup.
- `structured-content` renders text/image/document/reasoning content arrays and
  switches to exact payload in Raw mode.
- `tool-cards` renders client/server/custom tools, JSON, errors, long values,
  browser actions, todos, and annotated screenshots.
- `citations` labels URL and transcript/scan references and opens popovers or
  destinations.
- `media-safety` renders data/local media while preventing automatic requests
  to untrusted remote URLs.
- `large-content` caps/folds oversized text and image-heavy panels without
  freezing resize or hiding the More control.

## How to get to it (user POV)

- Open Messages or expand model/tool/info events in Transcript.
- Toggle Raw for the exact content payload.
- Expand More/collapsible reasoning/tool sections, citations, record nodes, or
  image lightboxes.

## Driving it with Playwright

- Use a content fixture with known markdown, code, reasoning, tool call/output,
  citation, inline image, and remote image URL. Assert semantic rendered text,
  code, and controls rather than serialized HTML.
- Intercept network requests and assert remote media is not fetched
  automatically; inline `data:image` media should render.
- Toggle Raw and assert exact fixture fields, then return to rendered mode.
- Expand long tool input/output and image-heavy Info content; assert the More
  control appears and layout remains bounded.
- For links/citations, assert safe literal text and destination. Never allow
  crafted HTML, routes, or metadata to execute.

## Code landmarks

- Chat composition/tool rendering: `packages/inspect-components/src/chat/`,
  especially `MessageContent.tsx`, `MessageContents.tsx`, and `chat/tools/`.
- General rich/record rendering: `packages/inspect-components/src/content/`.
- Media policy: `packages/inspect-components/src/media/` and
  `packages/util/src/media.ts`.
- Markdown/sanitization/lightbox: `packages/react/src/components/markdownRendering.ts`,
  `renderedHtmlSanitizer.ts`, `MarkdownDiv.tsx`, and `LightboxCarousel.tsx`.
- Regression coverage: `apps/inspect/e2e/chat-components.spec.ts`,
  `info-image-repro.spec.ts`, `viewer-xss.spec.ts`, and component security/media
  tests in `packages/inspect-components` and `packages/react`.

## Gotchas

- The same tool component can render in Messages and Transcript with different
  surrounding collapse/navigation state.
- Remote media is deliberately inert until a safe user action; a broken-image
  placeholder can be the security feature working as designed.
- Raw mode must show the exact payload, while rendered mode may project or
  omit opaque implementation fields.
- Large-content caps are performance boundaries. Removing truncation to fix a
  visual complaint can recreate layerization/resize stalls.
- Markdown, breadcrumb, print, and JSON surfaces have separate escaping paths;
  a passing chat sanitizer test does not prove route/print safety.
