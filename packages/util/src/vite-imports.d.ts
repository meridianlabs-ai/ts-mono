// The Vite import suffixes the workspace uses, declared here rather than via
// "vite/client" (see apps/inspect/src/vite-env.d.ts). Importers pull this in
// with `/// <reference types=… />` (relative inside util,
// "@tsmono/util/vite-imports" elsewhere), so every program that compiles
// them sees exactly one copy.
declare module "*?worker&url" {
  const url: string;
  export default url;
}

declare module "*?raw" {
  const text: string;
  export default text;
}
