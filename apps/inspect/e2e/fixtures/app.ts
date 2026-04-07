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
      });

      await network.enable();
      await use(network);
      await network.disable();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
