/**
 * The scanner_result_view glob table is unit-tested in viewerConfig.test.ts;
 * these check that a matched pattern reaches the sample's scan sidebar and
 * that an over-limit pattern surfaces as an error panel.
 */
import { testScore } from "@tsmono/inspect-common/testing";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

type Page = Parameters<Parameters<typeof test>[2]>[0]["page"];
type Network = Parameters<Parameters<typeof test>[2]>[0]["network"];

const kEvidence = "Scanner evidence remains visible";

async function openScannerSample(
  page: Page,
  network: Network,
  pattern: string,
  scanner: string
) {
  const sample = createEvalSample({ id: 1, messages: [] });
  sample.scores = {
    [scanner]: testScore({
      value: true,
      explanation: kEvidence,
      metadata: { scanner_references: [] },
    }),
  };
  const log = createEvalLog({
    samples: [sample],
    eval: {
      viewer: {
        scanner_result_view: {
          [pattern]: { fields: ["value"], exclude_fields: ["explanation"] },
        },
      },
    },
  });
  const file = "scanner-glob.json";
  serveEvalLog(network, log, file);
  await page.goto(`/#/logs/${file}/samples/sample/1/1/messages`);
}

test("a nested globstar pattern applies its view to the scan sidebar", async ({
  page,
  network,
}) => {
  await openScannerSample(
    page,
    network,
    "package/**/scanner",
    "package/nested/scanner"
  );

  // The scanner's entry renders, but the view excludes its explanation.
  const sidebar = page.getByLabel("Sample scans");
  await expect(sidebar).toContainText("package/nested/scanner");
  await expect(sidebar).not.toContainText(kEvidence);
  await expect(page.getByTestId("error-panel")).toHaveCount(0);
});

test("an over-limit scanner glob displays an error", async ({
  page,
  network,
}) => {
  await openScannerSample(page, network, "a".repeat(4097), "scanner");

  await expect(page.getByTestId("error-panel")).toContainText(
    "Scanner result view glob patterns and scanner names must be at most 4096 characters."
  );
});
