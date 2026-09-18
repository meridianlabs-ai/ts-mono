import { defineNetworkFixture, type NetworkFixture } from "@msw/playwright";
import { test as base } from "@playwright/test";

import { defaultHandlers } from "./handlers";

interface AppFixtures {
  network: NetworkFixture;
}

export const test = base.extend<AppFixtures>({
  // Wire up MSW handlers via @msw/playwright
  network: [
    async ({ context }, use) => {
      const network = defineNetworkFixture({
        context,
        handlers: defaultHandlers,
        // The inspect API encodes log filenames in URL paths (e.g.
        // /api/logs/test-chat.json) which MSW classifies as static
        // asset requests and skips by default.
        skipAssetRequests: false,
      });

      // Against a real view server (E2E_LOG_DIR, see serve-log.ts) nothing
      // is mocked: requests go through vite's /api proxy.
      if (!process.env.E2E_LOG_DIR) await network.enable();
      await use(network);
      if (!process.env.E2E_LOG_DIR) await network.disable();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
