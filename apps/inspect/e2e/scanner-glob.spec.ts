import { testScore } from "@tsmono/inspect-common/testing";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

const cases = [
  {
    title: "attack leaves sidebar responsive",
    pattern: "*a".repeat(24),
    scanner: "a".repeat(40) + "b",
    expected: "evidence",
  },
  {
    title: "limit displays an error",
    pattern: "a".repeat(4097),
    scanner: "scanner",
    expected: "error",
  },
  {
    title: "star keeps namespaced evidence visible",
    pattern: "*",
    scanner: "package/scanner",
    expected: "evidence",
  },
  {
    title: "star keeps hidden scanner evidence visible",
    pattern: "*",
    scanner: ".scanner",
    expected: "evidence",
  },
  {
    title: "globstar applies to zero intermediate segments",
    pattern: "package/**/scanner",
    scanner: "package/scanner",
    expected: "hidden",
  },
  {
    title: "globstar applies to nested scanners",
    pattern: "package/**/scanner",
    scanner: "package/nested/scanner",
    expected: "hidden",
  },
  {
    title: "globstar keeps hidden segments visible",
    pattern: "package/**/scanner",
    scanner: "package/.nested/scanner",
    expected: "evidence",
  },
];

for (const { title, pattern, scanner, expected } of cases) {
  test(`scanner glob ${title}`, async ({ page, network }) => {
    const sample = createEvalSample({ id: 1, messages: [] });
    sample.scores = {
      [scanner]: testScore({
        value: true,
        explanation: "Scanner evidence remains visible",
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

    if (expected === "error") {
      await expect(page.getByTestId("error-panel")).toContainText(
        "Scanner result view glob patterns and scanner names must be at most 4096 characters."
      );
    } else {
      const sidebar = page.getByLabel("Sample scans");
      await expect(sidebar).toBeVisible();
      if (expected === "evidence") {
        await expect(sidebar).toContainText("Scanner evidence remains visible");
      } else {
        await expect(sidebar).not.toContainText(
          "Scanner evidence remains visible"
        );
      }
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
