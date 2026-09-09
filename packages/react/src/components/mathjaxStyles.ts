// Third-party notices: mathjaxStyles.LICENSE. mathjaxStyles.test.ts explains
// why this copy exists, checks it against the sheet MathJax emits, and lists
// every deliberate difference with its reason.
const MATHJAX_STYLES = `
:scope {
  display: contents;
}
:scope mjx-container[jax="SVG"] {
  direction: ltr;
  position: relative;
}
:scope mjx-container[jax="SVG"] > svg {
  /* WebKit ignores overflow-clip-margin and clips at the SVG box. */
  overflow: clip;
  overflow-clip-margin: 1em;
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
  user-select: text !important;
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
:scope mjx-container[jax="SVG"] path[data-c], :scope mjx-container[jax="SVG"] use[data-c] {
  stroke-width: 3;
}
:scope g[data-mml-node="xypic"] path {
  stroke-width: inherit;
}
`;

export const mathJaxStyles = (scopeId: string): string =>
  MATHJAX_STYLES.replaceAll(":scope", `#${scopeId}`).trim();
