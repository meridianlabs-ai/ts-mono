// The one Vite import suffix the workspace uses, declared here rather than
// via "vite/client" (see apps/inspect/src/vite-env.d.ts). Importers pull it
// in with a relative `/// <reference types=… />`, so every program that
// compiles them sees exactly one copy.
declare module "*?worker&url" {
  const url: string;
  export default url;
}
