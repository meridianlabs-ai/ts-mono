import { defineNetworkFixture, type NetworkFixture } from "@msw/playwright";
import { test as base, expect, type Page } from "@playwright/test";

import { defaultHandlers } from "./handlers";

/**
 * MockEventSource script injected via page.addInitScript().
 *
 * Immediately dispatches an SSE message with topic versions so the app's
 * useTopicInvalidation hook unblocks and the UI renders.
 */
const MOCK_EVENT_SOURCE_SCRIPT = `
  window.EventSource = class MockEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    readyState = 0;
    onopen = null;
    onmessage = null;
    onerror = null;
    url;

    constructor(url) {
      this.url = url;
      // Transition to OPEN and dispatch initial topic versions on next microtask
      Promise.resolve().then(() => {
        this.readyState = 1;
        if (this.onopen) this.onopen(new Event("open"));
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent("message", {
              data: JSON.stringify({ scans: "t1", "project-config": "p1" }),
            }),
          );
        }
      });
    }

    close() {
      this.readyState = 2;
    }

    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
  };
`;

interface AppFixtures {
  network: NetworkFixture;
  disableRetries: void;
  /** Off for a test that triggers CSP violations on purpose; it then asserts
   *  `cspViolations` itself. */
  allowCspViolations: boolean;
  /** Every CSP violation a page in the test has logged so far. */
  cspViolations: string[];
}

export const test = base.extend<AppFixtures>({
  // Override page to inject SSE mock before any navigation
  page: async ({ page }, use) => {
    await page.addInitScript(MOCK_EVENT_SOURCE_SCRIPT);
    await use(page); // eslint-disable-line react-hooks/rules-of-hooks
  },

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

  allowCspViolations: [false, { option: true }],
  // The preview build serves the viewer's CSP, so every spec doubles as a
  // check that what it renders works under the policy: a blocked stylesheet,
  // icon or media source often still passes a rendering assertion. Every page
  // in the context is watched. The dev server sends no policy, so this never
  // fires for the dataframe harness.
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

  // Opt-in fixture: destructure in a test to disable React Query retries
  disableRetries: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        globalThis.__TEST_DISABLE_RETRY = true;
      });
      await use();
    },
    { auto: false },
  ],
});

export { expect };
