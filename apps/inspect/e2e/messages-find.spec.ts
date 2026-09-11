/**
 * E2E tests for cmd+f on the Messages tab, which searches the message rows
 * through the find coordinator (not the DOM): role headers count, matches
 * far outside the rendered window are stepped to, and the Transcript tab
 * keeps its window.find path.
 */
import type { Page } from "@playwright/test";

import type { ChatMessage } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  expectSameView,
  settledView,
  viewState,
} from "./fixtures/sample-scroller";
import {
  FIND_FAILING_TERM,
  FIND_PAGE_ROWS,
  serveEvalLog,
} from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

const MESSAGE_COUNT = 250;
const NEEDLE_ROWS = [5, 120, 240];

function generateMessages(options: { duplicateAssistantIds: boolean }) {
  return Array.from({ length: MESSAGE_COUNT }, (_, i): ChatMessage => {
    const assistant = i % 2 === 1;
    const needle = NEEDLE_ROWS.includes(i) ? " needle" : "";
    return {
      id: assistant && options.duplicateAssistantIds ? "shared-id" : `m${i}`,
      role: assistant ? "assistant" : "user",
      content: `message-${i}${needle}`,
      source: assistant ? "generate" : "input",
    };
  });
}

const ASSISTANT_COUNT = MESSAGE_COUNT / 2;

async function openMessages(
  page: Page,
  network: Parameters<typeof serveEvalLog>[0],
  messages: ChatMessage[],
  tab: "messages" | "transcript" = "messages"
) {
  const sample = createEvalSample({ id: 1, epoch: 1, messages });
  // Per test: against a real server the specs share one log dir.
  const logFile = `test-find-${test.info().testId}.json`;
  serveEvalLog(network, createEvalLog({ samples: [sample] }), logFile);
  await page.goto(
    `/#/logs/${encodeURIComponent(logFile)}/samples/sample/1/1/${tab}`
  );
  // The messages tab renders rows; the transcript tab of this events-less
  // sample renders the joined input paragraph (still containing "needle").
  await expect(
    page.getByText("message-0", { exact: tab === "messages" }).first()
  ).toBeVisible();
  return logFile;
}

async function openFind(page: Page, term: string) {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Find");
  await input.fill(term);
  return input;
}

const count = (page: Page) => page.getByTestId("find-band-match-count");

/** Painted occurrences: every match plus the active one (find-active alone
 *  paints it). */
const paintedCount = (page: Page) =>
  page.evaluate(
    () =>
      (CSS.highlights.get("find-match")?.size ?? 0) +
      (CSS.highlights.get("find-active")?.size ?? 0)
  );

/** The active highlight: its text and the row (data-find-anchor) it sits in. */
const activeHighlight = (page: Page) =>
  page.evaluate(() => {
    const active = CSS.highlights.get("find-active");
    const ranges = active ? [...active] : [];
    const first = ranges[0] instanceof Range ? ranges[0] : undefined;
    const row =
      first?.startContainer.parentElement?.closest("[data-find-anchor]");
    // The visible box is the nearest scrolling ancestor's, not the window's.
    let scroller = row?.parentElement ?? null;
    while (scroller && getComputedStyle(scroller).overflowY !== "auto") {
      scroller = scroller.parentElement;
    }
    const view = scroller
      ? scroller.getBoundingClientRect()
      : new DOMRect(0, 0, innerWidth, innerHeight);
    const within = (r: DOMRect | undefined) =>
      r !== undefined && r.top >= view.top && r.bottom <= view.bottom;
    return {
      count: ranges.length,
      text: first?.cloneContents().textContent ?? null,
      rowText: row?.textContent ?? null,
      inViewport: within(row?.getBoundingClientRect()),
      rangeInViewport: within(first?.getBoundingClientRect()),
    };
  });

/** Inline `maxHeight` of each ExpandablePanel in the row containing `text`
 *  (a collapsed panel sets it; an expanded one leaves it ""). */
const panelMaxHeightsInRow = (page: Page, text: string) =>
  page.evaluate((needle) => {
    const row = [...document.querySelectorAll("[data-find-anchor]")].find(
      (candidate) => candidate.textContent.includes(needle)
    );
    const panels = row ? row.querySelectorAll("[data-expandable-panel]") : [];
    return [...panels].map((panel) => {
      const content = panel.firstElementChild;
      return content instanceof HTMLElement ? content.style.maxHeight : null;
    });
  }, text);

test.describe("messages find", () => {
  test("counts every assistant role header, accumulating M across the source's pages", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      generateMessages({ duplicateAssistantIds: false })
    );
    const findRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/find-messages/")) {
        findRequests.push(request.postData() ?? "");
      }
    });

    await openFind(page, "assistant");

    // 125 matching rows over 40-row pages: the band reads M+ until the page
    // that walks off the end, then the exact total.
    await expect(count(page)).toHaveText(`1 of ${ASSISTANT_COUNT}`);
    expect(findRequests.length).toBeGreaterThanOrEqual(
      Math.ceil(ASSISTANT_COUNT / FIND_PAGE_ROWS)
    );
    expect(findRequests.filter((body) => body.includes('"after"'))).not.toEqual(
      []
    );
    await expect
      .poll(async () => (await activeHighlight(page)).text)
      .toBe("assistant");
  });

  test("expands a collapsed panel whose active occurrence sits below its fold", async ({
    page,
    network,
  }) => {
    const messages = generateMessages({ duplicateAssistantIds: false });
    // A user message (15-line fold) of 40 paragraphs with the hit last.
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    messages[30]!.content = [...lines, "foldneedle"].join("\n\n");
    await openMessages(page, network, messages);

    await openFind(page, "foldneedle");
    await expect(count(page)).toHaveText("1 of 1");
    await expect
      .poll(() => activeHighlight(page))
      .toMatchObject({ count: 1, text: "foldneedle", rangeInViewport: true });
    expect(await panelMaxHeightsInRow(page, "foldneedle")).toEqual([""]);

    // Off the row again, the panel folds back.
    await page.getByPlaceholder("Find").fill("message-31");
    await expect(count(page)).toHaveText("1 of 1");
    await expect
      .poll(() => panelMaxHeightsInRow(page, "foldneedle"))
      .toEqual(["15rem"]);
  });

  test("reveals an occurrence deep inside a collapsed panel of a mounted row", async ({
    page,
    network,
  }) => {
    const messages = generateMessages({ duplicateAssistantIds: false });
    // A row the list already renders at the top, whose hit lies thousands of
    // px below the panel's fold: centring on the clipped position would
    // scroll past the rows the list keeps mounted and unmount the row.
    const lines = Array.from({ length: 300 }, (_, i) => `deep line ${i}`);
    messages[3]!.content = [...lines, "deepneedle"].join("\n\n");
    await openMessages(page, network, messages);

    await openFind(page, "deepneedle");
    await expect(count(page)).toHaveText("1 of 1");
    await expect
      .poll(() => activeHighlight(page))
      .toMatchObject({ count: 1, text: "deepneedle", rangeInViewport: true });
    expect(await panelMaxHeightsInRow(page, "deepneedle")).toEqual([""]);
  });

  test("steps to matches far outside the rendered window and wraps", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      generateMessages({ duplicateAssistantIds: false })
    );

    const input = await openFind(page, "needle");
    await expect(count(page)).toHaveText("1 of 3");

    await input.press("Enter");
    await expect(count(page)).toHaveText("2 of 3");
    await expect
      .poll(() => activeHighlight(page))
      .toMatchObject({ count: 1, text: "needle", inViewport: true });
    expect((await activeHighlight(page)).rowText).toContain("message-120");

    await input.press("Shift+Enter");
    await input.press("Shift+Enter");
    await expect(count(page)).toHaveText("3 of 3");
    await expect
      .poll(() => activeHighlight(page))
      .toMatchObject({ count: 1, text: "needle", rangeInViewport: true });
    expect((await activeHighlight(page)).rowText).toContain("message-240");

    await input.press("Enter");
    await expect(count(page)).toHaveText("1 of 3");
    await expect
      .poll(() => activeHighlight(page))
      .toMatchObject({ count: 1, text: "needle", rangeInViewport: true });
    expect((await activeHighlight(page)).rowText).toContain("message-5");
  });

  test("brings the active occurrence of a row taller than the viewport into view", async ({
    page,
    network,
  }) => {
    const messages = generateMessages({ duplicateAssistantIds: false });
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    messages[60]!.content = [...lines, "tallneedle"].join("\n\n");
    await openMessages(page, network, messages);

    await openFind(page, "tallneedle");
    await expect(count(page)).toHaveText("1 of 1");
    await expect
      .poll(() => activeHighlight(page))
      .toMatchObject({ count: 1, text: "tallneedle", rangeInViewport: true });
  });

  test("keeps one active highlight when messages share an id", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      generateMessages({ duplicateAssistantIds: true })
    );

    const input = await openFind(page, "assistant");
    await expect(count(page)).toHaveText(`1 of ${ASSISTANT_COUNT}`);

    for (const expected of ["2", "3", "4"]) {
      await input.press("Enter");
      await expect(count(page)).toHaveText(`${expected} of ${ASSISTANT_COUNT}`);
      await expect
        .poll(() => activeHighlight(page))
        .toMatchObject({ count: 1, text: "assistant" });
    }
  });

  test("shows No results and clears highlights on Escape", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      generateMessages({ duplicateAssistantIds: false })
    );

    const input = await openFind(page, "absent-term");
    await expect(count(page)).toHaveText("No results");

    await input.fill("needle");
    await expect(count(page)).toHaveText("1 of 3");
    await expect.poll(() => paintedCount(page)).toBeGreaterThan(0);
    await input.press("Escape");
    await expect(input).toBeHidden();
    await expect.poll(() => paintedCount(page)).toBe(0);
  });

  test("shows a failed search in the band until the next search, without moving the input", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      generateMessages({ duplicateAssistantIds: false })
    );
    const input = await openFind(page, "needle");
    await expect(count(page)).toHaveText("1 of 3");
    const left = await input.evaluate((el) => el.getBoundingClientRect().left);

    await input.fill(FIND_FAILING_TERM);
    await expect(count(page)).toHaveText("Error");
    await expect(page.getByTestId("find-band-error")).toContainText("500");
    await expect.poll(() => paintedCount(page)).toBe(0);
    expect(await input.evaluate((el) => el.getBoundingClientRect().left)).toBe(
      left
    );

    await input.fill("needle");
    await expect(count(page)).toHaveText("1 of 3");
    await expect(page.getByTestId("find-band-error")).toHaveCount(0);
  });

  test("returns to the same match after switching tabs and back", async ({
    page,
    network,
  }) => {
    // Short viewport: the sample header's collapse after the return would
    // otherwise push the centred row above the fold unnoticed.
    await page.setViewportSize({ width: 900, height: 600 });
    const logFile = await openMessages(
      page,
      network,
      generateMessages({ duplicateAssistantIds: false })
    );
    const input = await openFind(page, "needle");
    await expect(count(page)).toHaveText("1 of 3");
    await input.press("Enter");
    await expect(count(page)).toHaveText("2 of 3");

    const go = (tab: string) =>
      page.evaluate(
        ({ file, t }) => {
          location.hash = `#/logs/${encodeURIComponent(file)}/samples/sample/1/1/${t}`;
        },
        { file: logFile, t: tab }
      );
    await go("transcript");
    await expect(page.getByText("message-0").first()).toBeVisible();
    await go("messages");
    await expect(count(page)).toHaveText("2 of 3");
    await expect
      .poll(async () => (await activeHighlight(page)).rowText)
      .toContain("message-120");
    await expect
      .poll(async () => (await activeHighlight(page)).rangeInViewport)
      .toBe(true);
  });

  test("keeps a wheeled position past the active match across a transcript find", async ({
    page,
    network,
  }) => {
    // A find landing, then a scroll away from it: the position the user left
    // is what the tab must reopen at, not a re-centred match — even after the
    // transcript's own find moved the shared container.
    await openMessages(
      page,
      network,
      generateMessages({ duplicateAssistantIds: false })
    );
    const input = await openFind(page, "needle");
    await expect(count(page)).toHaveText("1 of 3");
    await input.press("Enter");
    await input.press("Enter");
    await expect(count(page)).toHaveText("3 of 3");
    await expect
      .poll(async () => (await activeHighlight(page)).rowText)
      .toContain("message-240");

    const row = page.locator("[data-find-anchor]", { hasText: "message-240" });
    const box = await row.boundingBox();
    await page.mouse.move(box!.x + 10, box!.y + 10);
    const landed = (await viewState(page)).scrollTop;
    await page.mouse.wheel(0, 600);
    // The wheel scrolls asynchronously; wait for it to have moved the view.
    await expect
      .poll(async () => (await viewState(page)).scrollTop)
      .not.toBe(landed);
    const before = await settledView(page);

    await page.locator("#transcript").click();
    await expect(page.locator("#transcript")).toHaveClass(/active/);
    await page.getByPlaceholder("Find").click();
    await page.getByPlaceholder("Find").press("Enter");
    await page.locator("#messages").click();
    await expectSameView(page, before);
    await expect(count(page)).toHaveText("3 of 3");
  });

  test("the transcript tab still uses the window.find path", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      generateMessages({ duplicateAssistantIds: false }),
      "transcript"
    );

    // A term inside the visible (uncollapsed) part of the input paragraph.
    const input = await openFind(page, "message-4");
    await input.press("Enter");

    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toMatch(/message-4/i);
    expect(await page.evaluate(() => CSS.highlights.has("find-active"))).toBe(
      false
    );
  });
});
