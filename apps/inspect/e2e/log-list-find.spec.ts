/**
 * E2E tests for the log-list find band (Cmd/Ctrl+F).
 *
 * Match membership is a data-level query against the listing source (see
 * readLogsListingMatches) running under a type-ahead debounce, so these
 * exercise the full path: shortcut → typed term → debounced match query →
 * counter/selection, plus the "No results" gating that must not flash
 * while a keystroke's query is still in flight.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/app";
import {
  setupLogListHandlers,
  waitForGrid,
} from "./fixtures/log-list-scenario";

function findInput(page: Page) {
  return page.getByPlaceholder("Find");
}

function matchStatus(page: Page) {
  return page.getByTestId("find-band-match-count");
}

async function openFindBand(page: Page) {
  await page.keyboard.press("ControlOrMeta+f");
  await expect(findInput(page)).toBeVisible();
  await expect(findInput(page)).toBeFocused();
}

test.describe("Log-list find band", () => {
  test("finds a unique term and selects its row", async ({ page, network }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await openFindBand(page);
    await findInput(page).fill("beta");

    await expect(matchStatus(page)).toHaveText("1 of 1");
    await expect(
      page.getByRole("row").filter({ hasText: "task-beta" })
    ).toHaveAttribute("aria-selected", "true");
  });

  test("navigates between matches with the counter tracking", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await openFindBand(page);
    await findInput(page).fill("task-");

    await expect(matchStatus(page)).toHaveText("1 of 3");
    await page.getByTestId("find-band-next").click();
    await expect(matchStatus(page)).toHaveText("2 of 3");
    await page.getByTestId("find-band-prev").click();
    await expect(matchStatus(page)).toHaveText("1 of 3");
  });

  test("reports no results only after the match query settles", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await openFindBand(page);
    await findInput(page).fill("no-such-log-anywhere");

    await expect(matchStatus(page)).toHaveText("No results");

    // Narrowing back to a matching term recovers from the no-results state.
    await findInput(page).fill("gamma");
    await expect(matchStatus(page)).toHaveText("1 of 1");
  });

  test("escape closes the band and clears the term", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await openFindBand(page);
    await findInput(page).fill("beta");
    await expect(matchStatus(page)).toHaveText("1 of 1");

    await page.keyboard.press("Escape");
    await expect(findInput(page)).toBeHidden();

    // Reopening starts clean — no stale term or counter.
    await openFindBand(page);
    await expect(findInput(page)).toHaveValue("");
    await expect(matchStatus(page)).toBeHidden();
  });
});
