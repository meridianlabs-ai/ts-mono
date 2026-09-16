import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";

import { splitTestEnvironments } from "@tsmono/vitest-config";

// @lit/react publishes a `node` export for SSR whose property and event
// wiring is compiled out. Vitest hands node_modules to Node's resolver, which
// picks that build, so the vscode-elements React wrappers silently drop
// props and events under jsdom. Point the wrapper at the browser build the
// app ships instead: alias @lit/react to it, and inline the wrapper package
// so the alias applies to its import.
const litReactBrowserEntry = (): string => {
  const require = createRequire(import.meta.url);
  const reactElements = require.resolve("@vscode-elements/react-elements");
  const nodeEntry = createRequire(reactElements).resolve("@lit/react");
  const browserEntry = nodeEntry.replace(/([\\/])node\1/, "$1");
  if (browserEntry === nodeEntry || !existsSync(browserEntry)) {
    throw new Error(`No browser build of @lit/react next to ${nodeEntry}`);
  }
  return browserEntry;
};

export default splitTestEnvironments(
  defineConfig({
    resolve: { alias: { "@lit/react": litReactBrowserEntry() } },
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["src/test/setup-msw.ts", "src/test/setup-web-components.ts"],
      server: { deps: { inline: [/@vscode-elements\/react-elements/] } },
    },
  }),
  import.meta.dirname
);
