// Third-party notices: mathjaxStyles.LICENSE.
// Fixed SVG styles from markdown-it-mathjax3 5.2.0 / mathxyjax3 0.8.3.
// Log-authored CSS must never supply selectors or positioning declarations.
// The unused fixed-position mjx-status rule is deliberately omitted.
const MATHJAX_STYLES = `
:scope {
  display: contents;
}
:scope mjx-assistive-mml {
  color: rgba(0, 0, 0, 0);
  user-select: text !important;
  clip: auto !important;
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
  clip: rect(1px, 1px, 1px, 1px);
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
:scope [jax="SVG"] mjx-tool {
  display: inline-block;
  position: relative;
  width: 0px;
  height: 0px;
}
:scope [jax="SVG"] mjx-tool > mjx-tip {
  position: absolute;
  top: 0px;
  left: 0px;
}
:scope mjx-tool > mjx-tip {
  display: inline-block;
  padding: 0.2em;
  border: 1px solid rgb(136, 136, 136);
  font-size: 70%;
  background-color: rgb(248, 248, 248);
  color: black;
  box-shadow: rgb(170, 170, 170) 2px 2px 5px;
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
