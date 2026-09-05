// Third-party notices: mathjaxStyles.LICENSE.
// Fixed SVG styles from markdown-it-mathjax3 5.2.0 / mathxyjax3 0.8.3.
// Log-authored CSS must never supply selectors or positioning declarations.
// Runtime tooltips/status are omitted: static SVG uses native title elements.
// Assistive MathML stays clipped even when a log forges its contents.
const MATHJAX_STYLES = `
:scope {
  display: contents;
}
:scope mjx-container[jax="SVG"] {
  direction: ltr;
}
:scope mjx-container[jax="SVG"] > svg {
  overflow: visible;
  min-height: 1px;
  min-width: 1px;
}
:scope mjx-container[jax="SVG"] > svg a {
  fill: blue;
  stroke: blue;
}
:scope mjx-assistive-mml {
  top: 0px;
  left: 0px;
  clip: rect(1px, 1px, 1px, 1px) !important;
  user-select: none;
  position: absolute !important;
  padding: 1px 0px 0px !important;
  border: 0px !important;
  display: block !important;
  width: auto !important;
  overflow: hidden !important;
}
:scope mjx-assistive-mml[display="block"] {
  width: 100% !important;
}
:scope mjx-container[jax="SVG"][display="true"] {
  display: block;
  text-align: center;
  margin: 1em 0px;
}
:scope mjx-container[jax="SVG"][display="true"][width="full"] {
  display: flex;
}
:scope mjx-container[jax="SVG"][justify="left"] {
  text-align: left;
}
:scope mjx-container[jax="SVG"][justify="right"] {
  text-align: right;
}
:scope g[data-mml-node="merror"] > g {
  fill: red;
  stroke: red;
}
:scope g[data-mml-node="merror"] > rect[data-background] {
  fill: yellow;
  stroke: none;
}
:scope g[data-mml-node="mtable"] > line[data-line], :scope svg[data-table] > g > line[data-line] {
  stroke-width: 70px;
  fill: none;
}
:scope g[data-mml-node="mtable"] > rect[data-frame], :scope svg[data-table] > g > rect[data-frame] {
  stroke-width: 70px;
  fill: none;
}
:scope g[data-mml-node="mtable"] > .mjx-dashed, :scope svg[data-table] > g > .mjx-dashed {
  stroke-dasharray: 140;
}
:scope g[data-mml-node="mtable"] > .mjx-dotted, :scope svg[data-table] > g > .mjx-dotted {
  stroke-linecap: round;
  stroke-dasharray: 0, 140;
}
:scope g[data-mml-node="mtable"] > g > svg {
  overflow: visible;
}
:scope g[data-mml-node="maction"][data-toggle] {
  cursor: pointer;
}
:scope foreignobject[data-mjx-xml] {
  font-family: initial;
  line-height: normal;
  overflow: visible;
}
:scope mjx-container[jax="SVG"] path[data-c], :scope mjx-container[jax="SVG"] use[data-c] {
  stroke-width: 3;
}
:scope g[data-mml-node="xypic"] path {
  stroke-width: inherit;
}
:scope .MathJax g[data-mml-node="xypic"] path {
  stroke-width: inherit;
}
`;

export const mathJaxStyles = (scopeId: string): string =>
  MATHJAX_STYLES.replaceAll(":scope", `#${scopeId}`).trim();
