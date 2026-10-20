import { onDemandModule } from "../hooks/onDemandModule";

// The markdown pipeline (markdown-it, DOMPurify, MathJax) loads on first
// trusted render, so none of it is fetched or run for untrusted content.
export const markdownPipeline = onDemandModule(
  () => import("./markdownPipeline")
);
