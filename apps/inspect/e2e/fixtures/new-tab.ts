import { expect, type Page } from "@playwright/test";

interface TargetEvent {
  targetInfo: {
    targetId: string;
    type: string;
    url: string;
    browserContextId?: string;
  };
}

/**
 * Run `gesture` and assert that it opens a new tab, in `page`'s browser
 * context, whose URL matches `url`.
 *
 * Uses browser-level CDP target events because Playwright's page tracking
 * is unreliable for background tabs opened by a native link gesture:
 * Chromium sometimes never sends that tab's `Page.frameNavigated`, so
 * `context.waitForEvent("page")` intermittently never fires (or the page's
 * URL stays about:blank).
 */
export async function expectNewTab(
  page: Page,
  gesture: () => Promise<void>,
  url: RegExp
): Promise<void> {
  const browser = page.context().browser();
  if (!browser) throw new Error("expectNewTab needs a launched browser");

  const pageSession = await page.context().newCDPSession(page);
  const { targetInfo: self } = await pageSession.send("Target.getTargetInfo");
  await pageSession.detach();
  if (!self.browserContextId) {
    throw new Error("expectNewTab: page target has no browserContextId");
  }

  const urls = new Map<string, string>();
  const record = ({ targetInfo }: TargetEvent) => {
    if (
      targetInfo.type === "page" &&
      targetInfo.browserContextId === self.browserContextId
    ) {
      urls.set(targetInfo.targetId, targetInfo.url);
    }
  };
  const cdp = await browser.newBrowserCDPSession();
  cdp.on("Target.targetCreated", record);
  cdp.on("Target.targetInfoChanged", record);
  try {
    // Discovery replays a targetCreated for every existing target first.
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    const existing = new Set(urls.keys());
    await gesture();
    await expect
      .poll(() =>
        [...urls].filter(([id]) => !existing.has(id)).map(([, u]) => u)
      )
      .toContainEqual(expect.stringMatching(url));
  } finally {
    await cdp.detach();
  }
}
