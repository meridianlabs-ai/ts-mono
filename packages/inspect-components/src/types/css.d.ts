// Lets plain `.css` imports resolve. `.module.css` imports prefer the sibling
// `.module.css.d.ts` that `typed-css-modules` generates.
declare module "*.css" {
  const stylesheet: string;
  export default stylesheet;
}
