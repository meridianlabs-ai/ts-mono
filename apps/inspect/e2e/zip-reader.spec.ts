/**
 * Browser-only checks for the ZIP reader's decompression workers: real
 * Blob-URL workers, buffer transfer, and which work leaves the main thread.
 * Size limits and malformed-input handling are unit-tested in
 * decompression.test.ts and remoteZipFile.test.ts.
 */
import { expect, test } from "@playwright/test";

/** The fixture's zstd entry and compressed frame both decode to 2 MiB. */
const kZstdEntrySize = 2 * 1024 * 1024;

interface ZipReaderFixture {
  readZstdEntriesTwice(): Promise<{
    firstLength: number;
    second: string;
    againLength: number;
    sourceByteLength: number;
  }>;
  decodeCompressedZstd(): Promise<{ length: number; workerRequests: number }>;
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
    expect(result).toMatchObject({
      firstLength: kZstdEntrySize,
      second: "hello",
      againLength: kZstdEntrySize,
    });
    // Transferring a view of the archive to the worker must not detach it.
    expect(result?.sourceByteLength).toBeGreaterThan(0);
  });

  test("compressed zstd decodes in the worker", async ({ page }) => {
    expect(
      await page.evaluate(() => window.zipReader?.decodeCompressedZstd())
    ).toEqual({ length: kZstdEntrySize, workerRequests: 1 });
  });

  test("a deflate entry decodes in the browser", async ({ page }) => {
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
