import { expect, test } from "@playwright/test";

// The fixture page imports app modules from /src, which only the dev server
// serves.
test(
  "ZIP worker reads preserve the source archive and bound forged output",
  { tag: "@dev-server" },
  async ({ page }) => {
    await page.goto("/e2e/fixtures/zip-reader.html");
    await expect(page.locator("output")).toHaveText(
      "Passed: zstd and deflate workers, repeated entry reads, archive ownership, forged output size"
    );
  }
);
