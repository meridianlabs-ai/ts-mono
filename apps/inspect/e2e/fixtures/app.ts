import { defineNetworkFixture, type NetworkFixture } from "@msw/playwright";
import { test as base, expect, type Page } from "@playwright/test";

import { defaultHandlers } from "./handlers";

interface AppFixtures {
  network: NetworkFixture;
  /** Off for a test that triggers CSP violations on purpose; it then asserts
   *  `cspViolations` itself. */
  allowCspViolations: boolean;
  /** Every CSP violation the page has logged so far. */
  cspViolations: string[];
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

      await network.enable();
      await use(network);
      await network.disable();
    },
    { auto: true },
  ],
  allowCspViolations: [false, { option: true }],
  // The preview build serves the viewer's CSP, so every spec doubles as a
  // check that what it renders works under the policy: a blocked stylesheet,
  // icon or media source often still passes a rendering assertion. Every page
  // in the context is watched, so print views and new tabs count too. The dev
  // server sends no policy, so this never fires there.
  cspViolations: [
    async ({ context, allowCspViolations }, use) => {
      const violations: string[] = [];
      const watch = (page: Page) =>
        page.on("console", (message) => {
          if (message.text().includes("Content Security Policy")) {
            violations.push(message.text());
          }
        });
      context.pages().forEach(watch);
      context.on("page", watch);
      await use(violations);
      if (!allowCspViolations) {
        expect(violations, "CSP violations").toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
