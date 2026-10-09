/**
 * Nested ExpandablePanels must not stack their "more…/less…" toggles on top
 * of each other. The assistant message panel wraps its content, and a
 * reasoning block is itself a panel; with the reasoning block last, the two
 * panels' bottom-right corners coincide and their sticky toggles share the
 * same stuck position.
 */
import { http, HttpResponse } from "msw";

import type { ChatMessage } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
} from "./fixtures/test-data";

const LOG_FILE = "test-nested-toggles.json";

type Page = Parameters<Parameters<typeof test>[2]>[0]["page"];
type Network = Parameters<Parameters<typeof test>[2]>[0]["network"];
type Box = { x: number; y: number; width: number; height: number };

const LONG_REASONING = Array.from(
  { length: 200 },
  (_, i) => `reasoning line ${i}`
).join("\n\n");

async function openNestedSample(page: Page, network: Network) {
  const messages: ChatMessage[] = [
    { role: "user", content: "Think it through", source: "input" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Here is how I got there." },
        {
          type: "reasoning",
          reasoning: LONG_REASONING,
          signature: null,
          redacted: false,
        },
      ],
      source: "generate",
    },
  ];
  const sample = createEvalSample({ id: 1, epoch: 1, messages });
  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: "nested-test", task_id: "nested" }],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", () => HttpResponse.json(evalLog)),
    http.get("*/api/log-headers*", () =>
      HttpResponse.json([
        {
          eval_id: logDetails.eval.eval_id,
          run_id: logDetails.eval.run_id,
          task: logDetails.eval.task,
          task_id: logDetails.eval.task_id,
          task_version: logDetails.eval.task_version,
          model: logDetails.eval.model,
          status: logDetails.status,
          started_at: logDetails.stats?.started_at,
          completed_at: logDetails.stats?.completed_at,
        },
      ])
    )
  );

  await page.goto(
    `/#/logs/${encodeURIComponent(LOG_FILE)}/samples/sample/1/1/messages`
  );
}

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
const ownToggle = (panel: ReturnType<Page["locator"]>) =>
  panel.getByRole("button", { name: TOGGLE_NAME }).last();

async function boxOf(locator: ReturnType<Page["locator"]>): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
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
  test("a collapsed outer panel shows only its own toggle", async ({
    page,
    network,
  }) => {
    await openNestedSample(page, network);
    const { outer, inner } = await expandInner(page);
    await expect(ownToggle(outer)).toHaveText("more...");
    await expect(outer.getByRole("button", { name: TOGGLE_NAME })).toHaveCount(
      1
    );
    await expect(inner.getByRole("button", { name: TOGGLE_NAME })).toHaveCount(
      0
    );
  });

  test("stuck toggles of expanded nested panels don't overlap", async ({
    page,
    network,
  }) => {
    await openNestedSample(page, network);
    const { outer, inner } = await expandBoth(page);

    // Put the middle of the reasoning block on screen: both panels'
    // bottoms are below the viewport, so both toggles are stuck.
    await inner.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.mouse.wheel(0, 600);

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
    await openNestedSample(page, network);
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
});
