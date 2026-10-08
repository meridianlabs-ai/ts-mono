import { delay, http, HttpResponse } from "msw";

import { decodeBase64Url, encodeBase64Url } from "@tsmono/util";

import { runBombadil } from "../../../../tooling/bombadil/run.mjs";
import { expect, test } from "../fixtures/app";
import {
  createMessagesEventsResponse,
  createModelEvent,
  createTranscriptInfo,
  createTranscriptsResponse,
} from "../fixtures/test-data";

async function explore(origin: string, specification: string, output: string) {
  const { code, log } = await runBombadil({
    origin,
    specification: `e2e/bombadil/${specification}`,
    output,
    debuggerPort: 9333,
  });
  expect(code, log.slice(-8000)).toBe(0);
}

test("transcript identity", async ({ page, network }, testInfo) => {
  const ids = ["alpha", "beta", "gamma"];
  const transcripts = ids.map((id, index) =>
    createTranscriptInfo({
      transcript_id: id,
      task_id: `Task ${id}`,
      model: `model-${id}`,
      score: index / 2,
      metadata: { expected: id },
    })
  );
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json(createTranscriptsResponse(transcripts))
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", async ({ params }) => {
      await delay(100);
      return HttpResponse.json(
        transcripts.find((item) => item.transcript_id === params.id)
      );
    }),
    http.get(
      "*/api/v2/transcripts/:dir/:id/messages-events",
      async ({ params }) => {
        const id = String(params.id);
        const directory = decodeBase64Url(String(params.dir)).endsWith(
          "/secondary"
        )
          ? "secondary"
          : "primary";
        await delay(id === "alpha" ? 650 : 150);
        return HttpResponse.json(
          createMessagesEventsResponse({
            messages: Array.from(
              { length: id === "beta" ? 4 : 40 },
              (_, index) => ({
                id: `${id}-message-${index}`,
                role: "assistant",
                content: `EVIDENCE_${id} message ${index}: DIRECTORY_${directory} ${"result details ".repeat((index % 5) + 1)}`,
              })
            ),
            events: Array.from({ length: id === "beta" ? 3 : 25 }, (_, index) =>
              createModelEvent({
                uuid: `${id}-event-${index}`,
                startSec: index * 3,
                endSec: index * 3 + 2,
                content: `EVIDENCE_${id} event ${index} DIRECTORY_${directory}`,
              })
            ),
          })
        );
      }
    )
  );
  const dir = encodeBase64Url("/home/test/project/.transcripts");
  await page.goto(`/#/transcripts/${dir}/alpha`);
  await expect(page.getByText("EVIDENCE_alpha event 0").first()).toBeVisible();
  await explore(
    "http://localhost:5186",
    "transcripts.ts",
    testInfo.outputPath("bombadil")
  );
});

for (const rows of [6, 500]) {
  test(`dataframe integrity (${rows} rows)`, async ({ page }, testInfo) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/e2e/fixtures/dataframe/?rows=${rows}`);
    await expect(page.getByRole("grid")).toBeVisible();
    await explore(
      "http://localhost:5186",
      "dataframe.ts",
      testInfo.outputPath("bombadil")
    );
    const checks = await page.evaluate(() => ({
      exports: Number(document.body.dataset.exportChecks ?? 0),
      activations: Number(document.body.dataset.activationChecks ?? 0),
      filters: Number(document.body.dataset.filterChecks ?? 0),
      panelScrolls: Number(document.body.dataset.panelScrollChecks ?? 0),
    }));
    await testInfo.attach("property-check-counts", {
      body: JSON.stringify(checks),
      contentType: "application/json",
    });
    expect(checks.exports).toBeGreaterThan(0);
    expect(checks.activations).toBeGreaterThan(0);
    expect(checks.filters).toBeGreaterThan(0);
    if (rows === 500) expect(checks.panelScrolls).toBeGreaterThan(0);
  });
}

test("dataframe filter transactions", async ({ page }, testInfo) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/e2e/fixtures/dataframe/?rows=500");
  await expect(page.getByRole("grid")).toBeVisible();
  await explore(
    "http://localhost:5186",
    "filter-transactions.ts",
    testInfo.outputPath("bombadil")
  );
  const checks = await page.evaluate(() => ({
    transactions: Number(document.body.dataset.transactions ?? 0),
    cancellations: Number(document.body.dataset.cancellations ?? 0),
    remounts: Number(document.body.dataset.remounts ?? 0),
  }));
  await testInfo.attach("property-check-counts", {
    body: JSON.stringify(checks),
    contentType: "application/json",
  });
  expect(checks.transactions).toBeGreaterThan(0);
  expect(checks.cancellations).toBeGreaterThan(0);
  expect(checks.remounts).toBeGreaterThan(0);
});
