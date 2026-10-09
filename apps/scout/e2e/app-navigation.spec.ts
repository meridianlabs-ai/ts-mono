import { expect, test } from "./fixtures/app";

test("clicking activity bar items navigates to correct routes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/#\/transcripts/);

  await page.locator("#project").click();
  await expect(page).toHaveURL(/#\/project/);

  await page.locator("#scans").click();
  await expect(page).toHaveURL(/#\/scans/);

  await page.locator("#validation").click();
  await expect(page).toHaveURL(/#\/validation/);

  await page.locator("#transcripts").click();
  await expect(page).toHaveURL(/#\/transcripts/);
});
