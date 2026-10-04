import { expect, test } from "@playwright/test";

test("ZIP worker reads preserve the source archive and bound forged output", async ({
  page,
}) => {
  await page.goto("/e2e/fixtures/zip-reader.html");
  await expect(page.locator("output")).toHaveText(
    "Passed: zstd and deflate workers, repeated entry reads, archive ownership, forged output size"
  );
});
