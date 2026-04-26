c; // Lets plain `.css` side-effect imports (stylesheet bundles, vendor themes)
// resolve. `.module.css` imports prefer the sibling `.module.css.d.ts` that
// `typed-css-modules` generates — so strict class typing still applies.
declare module "*.css";
