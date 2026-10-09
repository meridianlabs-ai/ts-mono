/**
 * Browser-only checks for the ZIP reader's decompression workers: real
 * Blob-URL workers, buffer transfer, and which work leaves the main thread.
 * Size limits and malformed-input handling are unit-tested in
 * decompression.test.ts and remoteZipFile.test.ts.
 */
import { expect, test } from "@playwright/test";

interface ZipReaderFixture {
  readZstdEntriesTwice(): Promise<{
    size: number;
    firstLength: number;
    second: string;
    againLength: number;
    sourceByteLength: number;
  }>;
  decodeCompressedZstd(): Promise<number>;
  largeHistoryWorkerRequests(): Promise<number>;
  aggregateBlocksWorkerRequests(): Promise<number>;
  readDeflateEntry(): Promise<number>;
}

declare global {
  interface Window {
    /** Set by e2e/fixtures/zip-reader.html once its modules load. */
    zipReader?: ZipReaderFixture;
  }
}

// The fixture page imports app modules from /src, which only the dev server
// serves.
test.describe("ZIP worker reads", { tag: "@dev-server" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/zip-reader.html");
    await expect(page.locator("output")).toHaveText("Ready");
  });

  test("repeated zstd entry reads keep other entries and the source archive intact", async ({
    page,
  }) => {
    const result = await page.evaluate(() =>
      window.zipReader?.readZstdEntriesTwice()
    );
    if (!result) throw new Error("zip-reader fixture not loaded");
    expect(result.firstLength).toBe(result.size);
    expect(result.second).toBe("hello");
    expect(result.againLength).toBe(result.size);
    // Transferring a view of the archive to the worker must not detach it.
    expect(result.sourceByteLength).toBeGreaterThan(0);
  });

  test("zstd and deflate entries decode in the browser's workers", async ({
    page,
  }) => {
    expect(
      await page.evaluate(() => window.zipReader?.decodeCompressedZstd())
    ).toBe(2 * 1024 * 1024);
    expect(
      await page.evaluate(() => window.zipReader?.readDeflateEntry())
    ).toBe(5000);
  });

  test("large zstd history and aggregate block work run in the worker", async ({
    page,
  }) => {
    expect(
      await page.evaluate(() => window.zipReader?.largeHistoryWorkerRequests())
    ).toBe(1);
    expect(
      await page.evaluate(() =>
        window.zipReader?.aggregateBlocksWorkerRequests()
      )
    ).toBe(1);
  });
});
