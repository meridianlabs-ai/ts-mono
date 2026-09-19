import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

// Real-backend drive for the sample Activity tab against a real agentic
// `.eval` log (50+ model turns, flaky tool errors, scoring). Generate the
// fixture with test_evals/agentic/ascii_art_python.py@ascii_art_flaky and
// point VERIFY_LOG_DIR at its log dir — see features/sample-activity.md.

const evidence = join(import.meta.dirname, "..", "evidence");

const logDir =
  process.env.VERIFY_LOG_DIR ??
  join(process.env.HOME ?? "", "code", "viewer-validation", "logs");
const evalLogs = readdirSync(logDir)
  .filter((f) => f.endsWith(".eval"))
  .sort();
// VERIFY_ACTIVITY_LOG pins an exact filename within VERIFY_LOG_DIR;
// otherwise prefer the flaky variant (guaranteed tool-error rows), newest
// first.
// || not ?? — an empty VERIFY_ACTIVITY_LOG means "not pinned".
const activityLog =
  process.env.VERIFY_ACTIVITY_LOG ||
  evalLogs.filter((f) => f.includes("ascii-art-flaky")).pop() ||
  evalLogs.filter((f) => f.includes("ascii-art")).pop();
// The error-styling proofs need the flaky task's deliberate tool failures.
const hasToolErrors = activityLog?.includes("flaky") === true;
// The compaction proofs need the compaction task's threshold-triggered
// CompactionEvents.
const hasCompactions = activityLog?.includes("compaction") === true;

const sampleUrl = (tab: string) =>
  `/#/logs/${encodeURIComponent(activityLog ?? "")}/samples/sample/${encodeURIComponent("ascii/car")}/1/${tab}`;

const shot = (page: import("@playwright/test").Page, name: string) =>
  page.screenshot({ path: join(evidence, name), fullPage: true });

test.beforeAll(() => {
  mkdirSync(evidence, { recursive: true });
});

test.skip(
  activityLog === undefined,
  "no ascii-art .eval fixture in VERIFY_LOG_DIR — generate it per features/sample-activity.md"
);

test("activity tab renders bands and history against a real dense log", async ({
  page,
}) => {
  await page.goto(sampleUrl("activity"));

  await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible({
    timeout: 20_000,
  });
  // Curated default-on bands (handoff 8a).
  await expect(
    page.getByText("MODEL & TOOL ACTIVITY", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("CONTEXT SIZE", { exact: true })).toBeVisible();
  await expect(page.getByText("TOKEN BURN", { exact: true })).toBeVisible();
  await expect(
    page.getByText("WORKING TIME", { exact: true })
  ).not.toBeVisible();
  // Scoring guarantees a score row; both fixture tasks terminate on a
  // sample limit (message or token) → a limit marker ▲ and pill.
  await expect(
    page.getByRole("button", { name: /Scores [1-9]/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Limits [1-9]/ })
  ).toBeVisible();
  // Matches the rail glyph ▲ and/or its history row (the row can sit
  // outside the virtualized window on long logs) — assert one is visible.
  await expect(
    page
      .getByRole("button", { name: /Sample hit (message|token) limit/ })
      .first()
  ).toBeVisible();
  // The flaky check_art tool additionally guarantees error rows.
  if (hasToolErrors) {
    await expect(
      page.getByRole("button", { name: /Errors [1-9]/ })
    ).toBeVisible();
  }
  await shot(page, "sample-activity-default-light.png");

  // The opt-in working band via its chip.
  await page.getByRole("button", { name: "Working time" }).click();
  await expect(page.getByText("WORKING TIME", { exact: true })).toBeVisible();
  if (hasToolErrors) {
    // Failed tool calls: error ✕ glyph on the rail (single or clustered —
    // cluster aria-labels concatenate member labels)…
    await expect(
      page.getByRole("button", { name: /Tool check_art errored/ }).first()
    ).toBeVisible();
    // …and the red-outlined span treatment in the merged band (or the red
    // failure hairlines when the band has degraded to the density strip).
    // SVG rects carry no roles — the CSS-module fragment is the one hook.
    expect(
      await page
        .locator("[class*='failedSpan'], [class*='densityFailure']")
        .count()
    ).toBeGreaterThan(0);
  } else {
    // Data-driven no-phantom check: whatever the log, error styling must
    // agree with the Errors pill — zero count means zero glyphs and zero
    // failed-span/hairline treatment.
    const errorsPill = await page
      .getByRole("button", { name: /^Errors \d+$/ })
      .textContent();
    const errorCount = Number(/\d+/.exec(errorsPill ?? "")?.[0] ?? "0");
    if (errorCount === 0) {
      await expect(
        page.getByRole("button", { name: "Errors 0" })
      ).toBeDisabled();
      await expect(page.getByRole("button", { name: /errored/ })).toHaveCount(
        0
      );
      await expect(
        page.locator("[class*='failedSpan'], [class*='densityFailure']")
      ).toHaveCount(0);
    }
  }
  await shot(page, "sample-activity-all-bands-light.png");

  // Turns axis: gap-free columns, TURN label; waiting has no extent on
  // this axis, so the Working time chip and band are hidden (not greyed)
  // and come back with Wall clock.
  const workingChip = page.getByRole("button", { name: /Working time/ });
  await page.getByRole("button", { name: "Turns" }).click();
  await expect(page.getByText("TURN", { exact: true })).toBeVisible();
  await expect(workingChip).toHaveCount(0);
  await expect(
    page.getByText("WORKING TIME", { exact: true })
  ).not.toBeVisible();
  await shot(page, "sample-activity-turns-light.png");
  await page.getByRole("button", { name: "Wall clock", exact: true }).click();
  await expect(workingChip).toBeVisible();
  await expect(page.getByText("WORKING TIME", { exact: true })).toBeVisible();
});

test("activity history filters and clicks through to the transcript", async ({
  page,
}) => {
  test.skip(!hasToolErrors, "needs the flaky task's deliberate tool errors");
  await page.goto(sampleUrl("activity"));
  await expect(page.getByText("TOKEN BURN", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // Errors pill narrows to the flaky tool failures.
  await page.getByRole("button", { name: /Errors [1-9]/ }).click();
  await expect(
    page.getByText(/art quality service unavailable/).first()
  ).toBeVisible();
  await shot(page, "sample-activity-errors-filter.png");

  // Click-through to the transcript via event uuid. Target the button in
  // the first VISIBLE row (the flaky tool's first failure, "call 3"):
  // clicking a DOM-order .first() button would scroll a mid-list row into
  // view and virtualized re-measurement shifts the list under the cursor.
  const firstErrorRow = page
    .getByRole("button", { name: /transient failure on call 3/ })
    .first();
  await expect(firstErrorRow).toBeInViewport();
  await expect(async () => {
    await firstErrorRow
      .getByRole("button", { name: "open in transcript →" })
      .click();
    await expect(page).toHaveURL(/\/transcript\?event=/, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await shot(page, "sample-activity-clickthrough-transcript.png");
});

test("compaction events render cliff drops, ▼ markers, and rows", async ({
  page,
}) => {
  test.skip(!hasCompactions, "needs the compaction task's CompactionEvents");
  await page.goto(sampleUrl("activity"));
  await expect(page.getByText("TOKEN BURN", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // Every CompactionEvent shows in the pill count and on the ▼ rail
  // (clusters keep the glyph and carry a bordered ×N count box above it).
  await expect(
    page.getByRole("button", { name: /Compactions 18/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Context compacted/ }).first()
  ).toBeVisible();
  const clusterBoxes = page.locator("[class*='clusterBoxText']");
  expect(await clusterBoxes.count()).toBeGreaterThan(0);
  await expect(clusterBoxes.first()).toHaveText(/×\d+/);

  // Context band (default-on): dashed cliff drop per compaction, annotated
  // "Nk → M".
  await expect(page.getByText("CONTEXT SIZE", { exact: true })).toBeVisible();
  await expect(page.locator("[class*='compactionDrop']")).toHaveCount(18);
  await expect(page.locator("[class*='compactionLabel']").first()).toHaveText(
    /\d+k? → \d+k?/
  );
  await shot(page, "sample-activity-compactions-light.png");

  // Densest fixture yet (1291 events / ~478 spans): the merged band must
  // degrade to the per-pixel occupancy strip.
  await expect(page.getByText(/per-pixel occupancy/)).toBeVisible();

  // Glyph clicks are inert (Charles, 2026-09-16): a Limits filter that hides
  // the compaction rows stays put, the search and row selection are
  // untouched, and no compaction row appears. Rows are matched by role and
  // class — the glyph's own hover card also says "Context compacted".
  const limits = page.getByRole("button", { name: /Limits 1/ });
  const search = page.getByPlaceholder("filter by event or detail");
  const historyRows = page.locator("[role='button'][class*='row']");
  const compactionRows = historyRows.filter({ hasText: "Context compacted" });
  await limits.click();
  await expect(limits).toHaveClass(/pillSelected/);
  await expect(compactionRows).toHaveCount(0);
  await expect(historyRows).toHaveCount(1);
  // On this fixture every compaction glyph is a cluster ("N events: …").
  const glyph = page
    .getByRole("button", { name: /^\d+ events: Context compacted/ })
    .and(page.locator("rect"))
    .first();
  await glyph.click();
  await expect(limits).toHaveClass(/pillSelected/);
  await expect(search).toHaveValue("");
  await expect(page.locator("[class*='rowSelected']")).toHaveCount(0);
  await expect(compactionRows).toHaveCount(0);
  await expect(historyRows).toHaveCount(1);
  await expect(page).toHaveURL(/\/activity$/);
  await shot(page, "sample-activity-compaction-glyph-inert.png");

  // Hovering the glyph still opens its card. A cluster card lists its
  // members and links to the earliest of them (Charles, 2026-09-16: a
  // collapsed range keeps a link to its first event), so the way through
  // from here is the card's own footer — reached the way a hand reaches
  // it, in small moves down from the rail across both rows' density
  // strips (review pass 15: a direct locator click skips the travel and
  // missed a strip taking the card over).
  await glyph.hover();
  const card = page.locator("[class*='tooltip']");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d+ events/);
  await expect(card).toContainText("Context compacted");
  const footer = card.getByRole("button", {
    name: "open first in transcript →",
  });
  await expect(footer).toBeVisible();
  const glyphBox = await glyph.boundingBox();
  const footerBox = await footer.boundingBox();
  if (!glyphBox || !footerBox) throw new Error("expected glyph and footer");
  const from = {
    x: glyphBox.x + glyphBox.width / 2,
    y: glyphBox.y + glyphBox.height / 2,
  };
  // A slip two pixels off the glyph and straight back inside the grace
  // keeps the card (review pass 16: the corridor guard swallowed the
  // return and the pending close ran out under the pointer).
  await page.mouse.move(from.x, glyphBox.y + glyphBox.height + 2);
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(450);
  await expect(card).toContainText("Context compacted");
  const to = {
    x: footerBox.x + footerBox.width / 2,
    y: footerBox.y + footerBox.height / 2,
  };
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
    await expect(card, `step ${i}`).toContainText("Context compacted");
  }
  await footer.click();
  await expect(page).toHaveURL(/\/transcript\?event=/);
});

test.describe(() => {
  test.use({ colorScheme: "dark" });

  test("activity tab renders in dark theme", async ({ page }) => {
    await page.goto(sampleUrl("activity"));
    await expect(page.getByText("TOKEN BURN", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Working time" }).click();
    await expect(
      page.getByText("MODEL & TOOL ACTIVITY", { exact: true })
    ).toBeVisible();
    await shot(page, "sample-activity-all-bands-dark.png");
  });
});
