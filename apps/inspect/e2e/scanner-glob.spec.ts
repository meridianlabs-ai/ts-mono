import { testScore } from "@tsmono/inspect-common/testing";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

for (const excessive of [false, true]) {
  test(`scanner glob ${excessive ? "limit displays an error" : "attack leaves sidebar responsive"}`, async ({
    page,
    network,
  }) => {
    const scanner = "a".repeat(40) + "b";
    const sample = createEvalSample({ id: 1, messages: [] });
    sample.scores = {
      [scanner]: testScore({
        value: true,
        explanation: "Scanner evidence remains visible",
        metadata: { scanner_references: [] },
      }),
    };
    const pattern = excessive ? "a".repeat(4097) : "*a".repeat(24);
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

    if (excessive) {
      await expect(page.getByTestId("error-panel")).toContainText(
        "Scanner result view glob patterns and scanner names must be at most 4096 characters."
      );
    } else {
      await expect(page.getByLabel("Sample scans")).toContainText(
        "Scanner evidence remains visible"
      );
      await expect(page.getByTestId("error-panel")).toHaveCount(0);
    }
    expect(
      await page.evaluate(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("responsive"), 0))
      )
    ).toBe("responsive");
  });
}
