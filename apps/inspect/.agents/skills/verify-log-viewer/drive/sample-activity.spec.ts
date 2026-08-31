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
  // Curated default-on bands.
  await expect(
    page.getByText("WORKING / WAITING", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("TOKEN BURN", { exact: true })).toBeVisible();
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

  // Opt-in bands via chips.
  await page.getByRole("button", { name: "Context size" }).click();
  await expect(page.getByText("CONTEXT SIZE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Model & tool activity" }).click();
  await expect(
    page.getByText("MODEL & TOOL ACTIVITY", { exact: true })
  ).toBeVisible();
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
  // (clusters keep the glyph and carry a ×N badge + concatenated labels).
  await expect(
    page.getByRole("button", { name: /Compactions 18/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Context compacted/ }).first()
  ).toBeVisible();

  // Context band: dashed cliff drop per compaction, annotated "Nk → M".
  await page.getByRole("button", { name: "Context size" }).click();
  await expect(page.getByText("CONTEXT SIZE", { exact: true })).toBeVisible();
  await expect(page.locator("[class*='compactionDrop']")).toHaveCount(18);
  await expect(page.locator("[class*='compactionLabel']").first()).toHaveText(
    /\d+k? → \d+k?/
  );
  await shot(page, "sample-activity-compactions-light.png");

  // Marker click widens a filter that would hide its row.
  await page.getByRole("button", { name: /Limits 1/ }).click();
  await expect(page.getByText("Context compacted").first()).not.toBeVisible();
  await page
    .getByRole("button", { name: /Context compacted/ })
    .first()
    .click();
  await expect(page.getByText("Context compacted").first()).toBeVisible();

  // Densest fixture yet (1291 events / ~478 spans): the merged band must
  // degrade to the per-pixel occupancy strip.
  await page.getByRole("button", { name: "Model & tool activity" }).click();
  await expect(page.getByText(/per-pixel occupancy/)).toBeVisible();
});

test.describe(() => {
  test.use({ colorScheme: "dark" });

  test("activity tab renders in dark theme", async ({ page }) => {
    await page.goto(sampleUrl("activity"));
    await expect(page.getByText("TOKEN BURN", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Context size" }).click();
    await page.getByRole("button", { name: "Model & tool activity" }).click();
    await expect(
      page.getByText("MODEL & TOOL ACTIVITY", { exact: true })
    ).toBeVisible();
    await shot(page, "sample-activity-all-bands-dark.png");
  });
});
