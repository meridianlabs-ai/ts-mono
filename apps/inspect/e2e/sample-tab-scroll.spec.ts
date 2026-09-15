/**
 * Scroll position across sample tab flips. The tabs share one scroll
 * container with the collapsible sample header above them; a tab's
 * VirtualList restores its persisted position when the tab is reopened and
 * must land on the same row at the same viewport y whatever state the header
 * was left in by the other tab.
 */
import type { Locator, Page } from "@playwright/test";

import type {
  ChatMessage,
  EvalSample,
  ModelEvent,
} from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  expectSameView,
  settledView,
  viewState,
} from "./fixtures/sample-scroller";
import { serveEvalLog } from "./fixtures/serve-log";
import {
  createEvalLog,
  createEvalSample,
  createModelOutput,
} from "./fixtures/test-data";

const MESSAGE_COUNT = 250;

function generateMessages(): ChatMessage[] {
  return Array.from({ length: MESSAGE_COUNT }, (_, i): ChatMessage => {
    const assistant = i % 2 === 1;
    return {
      id: `m${i}`,
      role: assistant ? "assistant" : "user",
      content: `message-${i}`,
      source: assistant ? "generate" : "input",
    };
  });
}

function generateModelEvents(count: number): ModelEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    event: "model",
    uuid: `model-${i}`,
    model: "claude-sonnet-4-5-20250929",
    input: [{ role: "user", content: `question ${i}`, id: null }],
    output: createModelOutput(`answer ${i}`),
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: "2025-01-15T10:00:00Z",
    working_start: 0,
    working_time: 3,
    error: null,
    traceback_ansi: null,
  }));
}

function generateMetadata(): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (let i = 0; i < 300; i++) {
    metadata[`key_${String(i).padStart(3, "0")}`] = `value ${i}`;
  }
  return metadata;
}

async function openSample(
  page: Page,
  network: Parameters<typeof serveEvalLog>[0],
  sample: EvalSample,
  tab: "messages" | "transcript" | "metadata"
) {
  const logFile = `test-tab-scroll-${test.info().testId}.json`;
  serveEvalLog(network, createEvalLog({ samples: [sample] }), logFile);
  await page.goto(
    `/#/logs/${encodeURIComponent(logFile)}/samples/sample/1/1/${tab}`
  );
}

async function wheelOver(page: Page, target: Locator, deltaY: number) {
  const box = await target.boundingBox();
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.mouse.wheel(0, deltaY);
}

const openTab = (page: Page, tab: string) => page.locator(`#${tab}`).click();

test.describe("sample tab scroll restore", () => {
  test("the messages tab returns to the last row at the same y after transcript round trips", async ({
    page,
    network,
  }) => {
    await openSample(
      page,
      network,
      createEvalSample({
        id: 1,
        epoch: 1,
        messages: generateMessages(),
        events: generateModelEvents(20),
      }),
      "messages"
    );
    await expect(page.getByText("message-0", { exact: true })).toBeVisible();
    const expandedHeader = (await viewState(page)).headerHeight;

    const lastRow = page.locator(`[data-item-index="${MESSAGE_COUNT - 1}"]`);
    await wheelOver(page, page.getByText("message-0", { exact: true }), 4000);
    await expect(async () => {
      await page.mouse.wheel(0, 4000);
      await expect(lastRow).toBeVisible({ timeout: 250 });
    }).toPass({ intervals: [100] });
    const before = await settledView(page);
    expect(before.headerHeight).toBeLessThan(expandedHeader);
    expect(before.index).toBeGreaterThan(MESSAGE_COUNT - 20);

    for (let round = 0; round < 3; round++) {
      await openTab(page, "transcript");
      // The transcript opens at its top (a wheel before it has positioned
      // itself would be the user's position to keep), where a wheel gesture
      // reveals the header — the state the messages tab must then land
      // under. (The reveal is skipped while the header's transition lock
      // from the collapse a moment ago is still running, hence the retry.)
      await expect.poll(async () => (await viewState(page)).scrollTop).toBe(0);
      const firstEvent = page.locator("[data-item-index]").first();
      await expect(async () => {
        await wheelOver(page, firstEvent, 20);
        await page.mouse.wheel(0, -20);
        expect((await viewState(page)).headerHeight).toBe(expandedHeader);
      }).toPass();
      await openTab(page, "messages");
      await expectSameView(page, before);
    }
  });

  test("the messages tab returns to the last row at the same y after a metadata round trip", async ({
    page,
    network,
  }) => {
    // The metadata tab is not virtualized: the host's own scroller state
    // takes over there, and its new-visit reset must not fire on the flip
    // (the messages list is still mounted and would persist it as its
    // position).
    await openSample(
      page,
      network,
      createEvalSample({
        id: 1,
        epoch: 1,
        messages: generateMessages(),
        metadata: generateMetadata(),
      }),
      "messages"
    );
    await expect(page.getByText("message-0", { exact: true })).toBeVisible();
    const lastRow = page.locator(`[data-item-index="${MESSAGE_COUNT - 1}"]`);
    await wheelOver(page, page.getByText("message-0", { exact: true }), 4000);
    await expect(async () => {
      await page.mouse.wheel(0, 4000);
      await expect(lastRow).toBeVisible({ timeout: 250 });
    }).toPass({ intervals: [100] });
    const before = await settledView(page);
    expect(before.index).toBeGreaterThan(MESSAGE_COUNT - 20);

    await openTab(page, "metadata");
    await expect(page.getByText("key_000:", { exact: true })).toBeVisible();
    await openTab(page, "messages");
    await expectSameView(page, before);
  });

  test("the metadata tab returns to its position after round trips through a turn-navigated transcript", async ({
    page,
    network,
  }) => {
    // The metadata tab is scrolled 10px with the header expanded; `j` in the
    // transcript collapses the header and keeps it so (navigation owns the
    // chrome until a gesture on the scroller), the state the metadata tab
    // then reopens under.
    await openSample(
      page,
      network,
      createEvalSample({
        id: 1,
        epoch: 1,
        messages: generateMessages().slice(0, 2),
        events: generateModelEvents(20),
        metadata: generateMetadata(),
      }),
      "metadata"
    );
    await expect(page.getByText("key_000:", { exact: true })).toBeVisible();
    const expandedHeader = (await viewState(page)).headerHeight;
    await wheelOver(page, page.getByText("key_000:", { exact: true }), 10);
    await expect.poll(async () => (await viewState(page)).scrollTop).toBe(10);
    const before = await settledView(page);

    for (let round = 0; round < 3; round++) {
      await openTab(page, "transcript");
      await expect(page.locator("[data-item-index]").first()).toBeVisible();
      // The first press from the top lands on turn 1 without moving; the
      // next one scrolls, and the landing forces the header collapsed.
      await expect(async () => {
        await page.keyboard.press("j");
        expect((await viewState(page)).headerHeight).toBeLessThan(
          expandedHeader
        );
      }).toPass();
      await openTab(page, "metadata");
      // The viewport top was above the list, in the sample header: the
      // container offset comes back as is. The header stays as the
      // transcript's navigation left it (it re-expands only at the top), so
      // its height is chrome state, recorded rather than asserted.
      await expect
        .poll(async () => {
          const now = await viewState(page);
          return { scrollTop: now.scrollTop, index: now.index };
        })
        .toEqual({ scrollTop: before.scrollTop, index: before.index });
      test.info().annotations.push({
        type: `header height after round ${round + 1}`,
        description: `${(await viewState(page)).headerHeight}px (before: ${before.headerHeight}px)`,
      });
    }
  });
});
