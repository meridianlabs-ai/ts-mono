/**
 * Nested ExpandablePanels must not stack their "more…/less…" toggles on top
 * of each other. The assistant message panel wraps its content, and a
 * reasoning block is itself a panel; with the reasoning block last, the two
 * panels' bottom-right corners coincide and their sticky toggles share the
 * same stuck position.
 */
import type { NetworkFixture } from "@msw/playwright";
import type { Locator, Page } from "@playwright/test";

import type { ChatMessage, Content } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

const LOG_FILE = "test-nested-toggles.json";

type Box = { x: number; y: number; width: number; height: number };

const lines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix} line ${i}`).join("\n\n");

const reasoning = (count: number): Content => ({
  type: "reasoning",
  reasoning: lines("reasoning", count),
  signature: null,
  redacted: false,
});

async function openSample(
  page: Page,
  network: NetworkFixture,
  assistant: ChatMessage[]
) {
  const messages: ChatMessage[] = [
    { role: "user", content: "Think it through", source: "input" },
    ...assistant,
  ];
  const sample = createEvalSample({ id: 1, epoch: 1, messages });
  serveEvalLog(
    network,
    createEvalLog({ samples: [sample] }),
    LOG_FILE,
    "nested-test"
  );
  await page.goto(
    `/#/logs/${encodeURIComponent(LOG_FILE)}/samples/sample/1/1/messages`
  );
}

/** Short text, then long reasoning: the reasoning panel is the message
 * panel's last content, so their corners coincide. */
const openReasoningLast = (page: Page, network: NetworkFixture) =>
  openSample(page, network, [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Here is how I got there." },
        reasoning(200),
      ],
      source: "generate",
    },
  ]);

const TOGGLE_NAME = /^(more|less)\.\.\.$/;

/** The assistant message panel (outer) and its reasoning panel (inner). */
function panels(page: Page) {
  const outer = page
    .locator('[data-expandable-panel="true"]', { hasText: "reasoning line 0" })
    .first();
  const inner = outer.locator(
    '[data-content-kind="reasoning"] [data-expandable-panel="true"]'
  );
  return { outer, inner };
}

/** The panel's own toggle is the last one inside it in DOM order — nested
 * panels' toggles come first, inside the content. */
const ownToggle = (panel: Locator) =>
  panel.getByRole("button", { name: TOGGLE_NAME }).last();

/** The wrapper that clips a collapsed panel's content. */
const contentOf = (panel: Locator) => panel.locator(":scope > div").first();

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("expected a laid-out element");
  return box;
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** Collapsed, the message panel fits the collapsed reasoning block, so only
 * the reasoning toggle shows; expanding it makes the message panel overflow. */
async function expandInner(page: Page) {
  const { outer, inner } = panels(page);
  await expect(outer).toBeVisible();
  await expect(outer.getByRole("button", { name: TOGGLE_NAME })).toHaveCount(1);
  await inner.getByRole("button", { name: "more..." }).click();
  await expect(ownToggle(outer)).toHaveText("more...");
  return { outer, inner };
}

async function expandBoth(page: Page) {
  const { outer, inner } = await expandInner(page);
  await ownToggle(outer).click();
  await expect(inner.getByRole("button", { name: "less..." })).toBeVisible();
  await expect(outer.getByRole("button", { name: "less..." })).toHaveCount(2);
  return { outer, inner };
}

test.describe("ExpandablePanel nested toggles", () => {
  test("a collapsed outer panel clips the nested toggle out of view", async ({
    page,
    network,
  }) => {
    await openReasoningLast(page, network);
    const { outer, inner } = await expandInner(page);

    // Pinned to the clip edge, the nested "less…" would sit beside the outer
    // "more…"; it belongs at its own panel's corner, below the clip.
    const clip = await boxOf(contentOf(outer));
    const innerToggle = await boxOf(ownToggle(inner));
    expect(innerToggle.y).toBeGreaterThanOrEqual(clip.y + clip.height);

    await ownToggle(outer).click();
    await expect(ownToggle(outer)).toHaveText("less...");
  });

  test("stuck toggles of expanded nested panels don't overlap", async ({
    page,
    network,
  }) => {
    await openReasoningLast(page, network);
    const { outer, inner } = await expandBoth(page);

    // Put the middle of the reasoning block on screen: both panels'
    // bottoms are below the viewport, so both toggles are stuck.
    await inner.evaluate((el) => el.scrollIntoView({ block: "center" }));

    const viewportHeight = page.viewportSize()?.height ?? 0;
    await expect(async () => {
      const outerPanel = await boxOf(outer);
      const innerPanel = await boxOf(inner);
      // Precondition: both panels extend past the viewport bottom.
      expect(innerPanel.y + innerPanel.height).toBeGreaterThan(viewportHeight);
      expect(outerPanel.y + outerPanel.height).toBeGreaterThan(viewportHeight);

      const outerToggle = await boxOf(ownToggle(outer));
      const innerToggle = await boxOf(ownToggle(inner));
      for (const t of [outerToggle, innerToggle]) {
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.y + t.height).toBeLessThanOrEqual(viewportHeight);
      }
      expect(intersects(outerToggle, innerToggle)).toBe(false);
    }).toPass({ timeout: 5_000 });
  });

  test("at rest each toggle sits in its own panel's corner", async ({
    page,
    network,
  }) => {
    await openReasoningLast(page, network);
    const { outer, inner } = await expandBoth(page);

    await outer.evaluate((el) => el.scrollIntoView({ block: "end" }));

    // "Its own corner": right-aligned with its panel, and its bottom within
    // a small inset of the panel's bottom edge.
    const kCornerInset = 12;
    await expect(async () => {
      for (const panel of [outer, inner]) {
        const p = await boxOf(panel);
        const t = await boxOf(ownToggle(panel));
        expect(p.x + p.width - (t.x + t.width)).toBeLessThanOrEqual(
          kCornerInset
        );
        expect(p.y + p.height - (t.y + t.height)).toBeGreaterThanOrEqual(0);
        expect(p.y + p.height - (t.y + t.height)).toBeLessThanOrEqual(
          kCornerInset
        );
      }
      const outerToggle = await boxOf(ownToggle(outer));
      const innerToggle = await boxOf(ownToggle(inner));
      expect(intersects(outerToggle, innerToggle)).toBe(false);
    }).toPass({ timeout: 5_000 });
  });

  test("reasoning before a long answer keeps its toggle and adds no gap", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      {
        role: "assistant",
        content: [reasoning(60), { type: "text", text: lines("answer", 60) }],
        source: "generate",
      },
    ]);
    const { outer, inner } = panels(page);

    // Both collapsed: the reasoning block's corner is inside the message's
    // visible area, so its toggle stays usable.
    await expect(outer.getByRole("button", { name: "more..." })).toHaveCount(2);
    await ownToggle(inner).click();
    await expect(ownToggle(inner)).toHaveText("less...");

    // The reasoning ends far above the message's corner, so the expanded
    // message reserves no extra space below its content.
    await ownToggle(outer).click();
    await expect(ownToggle(outer)).toHaveText("less...");
    const panel = await boxOf(outer);
    const content = await boxOf(contentOf(outer));
    expect(panel.y + panel.height - (content.y + content.height)).toBeLessThan(
      1
    );
  });

  // A collapsed panel decides whether it overflows by measuring its content,
  // nested toggles included. If nested toggles came and went with that
  // decision, a message near the threshold would re-render every frame.
  test("toggles of collapsed messages with nested JSON values settle", async ({
    page,
    network,
  }) => {
    // Each message is one long value (its own block-left toggle) plus `n`
    // short fields; the range spans the message panel's overflow threshold.
    const longValue = Array.from(
      { length: 40 },
      (_, i) => `value line ${i}`
    ).join("\n");
    const assistant: ChatMessage[] = Array.from({ length: 15 }, (_, n) => ({
      role: "assistant",
      content: JSON.stringify({
        long: longValue,
        ...Object.fromEntries(
          Array.from({ length: n }, (_, j) => [`k${j}`, `v${j}`])
        ),
      }),
      source: "generate",
    }));
    // Tall enough that every message mounts at once.
    await page.setViewportSize({ width: 1000, height: 8000 });
    await openSample(page, network, assistant);
    await expect(page.getByRole("button", { name: "long:" })).toHaveCount(15);

    const churn = await page.evaluate(async () => {
      const frames = (count: number) =>
        new Promise<void>((resolve) => {
          const tick = (left: number) => {
            if (left === 0) resolve();
            else requestAnimationFrame(() => tick(left - 1));
          };
          tick(count);
        });
      await frames(20);
      let changes = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of [...record.addedNodes, ...record.removedNodes]) {
            if (
              node instanceof Element &&
              (node.matches("button") || node.querySelector("button"))
            ) {
              changes++;
            }
          }
        }
      });
      for (const message of document.querySelectorAll(".assistant")) {
        observer.observe(message, { childList: true, subtree: true });
      }
      await frames(30);
      observer.disconnect();
      return changes;
    });
    expect(churn).toBe(0);
  });
});
