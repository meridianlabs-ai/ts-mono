import { createNetworkFixture, type NetworkFixture } from "@msw/playwright";
import { test as base } from "@playwright/test";

import { defaultHandlers } from "./handlers";

interface AppFixtures {
  network: NetworkFixture;
}

export const test = base.extend<AppFixtures>({
  // Wire up MSW handlers via @msw/playwright
  network: createNetworkFixture({
    initialHandlers: defaultHandlers,
  }),
});

export { expect } from "@playwright/test";
