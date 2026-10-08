import { writeFile } from "node:fs/promises";

import { delay, http, HttpResponse } from "msw";

import { decodeBase64Url, encodeBase64Url } from "@tsmono/util";

import { runBombadil } from "../../../../tooling/bombadil/run.mjs";
import type {
  MessagesEventsResponse,
  TranscriptInfo,
  TranscriptsResponse,
} from "../../src/types/api-types";
import { expect, test } from "../fixtures/app";
import {
  createMessagesEventsResponse,
  createModelEvent,
  createTranscriptInfo,
  createTranscriptsResponse,
} from "../fixtures/test-data";

test("transcript recovery after transient failures", async ({
  page,
  network,
}, testInfo) => {
  const transcripts = Array.from({ length: 12 }, (_, index) =>
    createTranscriptInfo({ transcript_id: `retry-${index}` })
  );
  const failures = new Set<string>();
  const recovered = new Set<string>();
  const shouldFail = (directory: string, id: string, part: string) => {
    const index = Number(id.replace("retry-", ""));
    if (part !== (index % 2 === 0 ? "info" : "messages")) return false;
    const key = `${directory}/${id}/${part}`;
    if (!failures.has(key)) {
      failures.add(key);
      return true;
    }
    recovered.add(key);
    return false;
  };
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(
        createTranscriptsResponse(transcripts)
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", async ({ params }) => {
      await delay(150);
      const id = String(params.id);
      if (shouldFail(String(params.dir), id, "info"))
        return new HttpResponse("Transient fixture failure", { status: 503 });
      const info = transcripts.find((item) => item.transcript_id === id);
      return info
        ? HttpResponse.json<TranscriptInfo>(info)
        : new HttpResponse(null, { status: 404 });
    }),
    http.get(
      "*/api/v2/transcripts/:dir/:id/messages-events",
      async ({ params }) => {
        await delay(250);
        const id = String(params.id);
        if (shouldFail(String(params.dir), id, "messages"))
          return new HttpResponse("Transient fixture failure", { status: 503 });
        const directory = decodeBase64Url(String(params.dir)).endsWith(
          "/secondary"
        )
          ? "secondary"
          : "primary";
        const index = Number(id.replace("retry-", ""));
        const content = `RECOVERY_${directory}_${index}`;
        return HttpResponse.json<MessagesEventsResponse>(
          createMessagesEventsResponse({
            messages: [{ id: `message-${index}`, role: "assistant", content }],
            events: [
              createModelEvent({
                uuid: `recovery-${index}`,
                startSec: 0,
                endSec: 1,
                content,
              }),
            ],
          })
        );
      }
    )
  );
  const directory = encodeBase64Url("/home/test/project/.transcripts");
  await page.goto(
    `/#/transcripts/${directory}/retry-0?tab=transcript-messages`
  );
  await expect(
    page.getByText("RECOVERY_primary_0", { exact: true })
  ).toBeVisible();
  const { code, log } = await runBombadil({
    origin: "http://localhost:5186",
    specification: "e2e/bombadil/recovery.ts",
    fixture: "e2e/bombadil/recovery.explore.ts",
    output: testInfo.outputPath("bombadil"),
    debuggerPort: 9333,
  });
  expect(code, log.slice(-8000)).toBe(0);
  const checks = await page.evaluate(() =>
    Number(document.body.dataset.recoveryChecks ?? 0)
  );
  const coverage = {
    failures: failures.size,
    recovered: recovered.size,
    checks,
  };
  const coveragePath = testInfo.outputPath("coverage.json");
  await writeFile(coveragePath, JSON.stringify(coverage));
  await testInfo.attach("recovery-coverage", {
    path: coveragePath,
    contentType: "application/json",
  });
  expect(coverage.failures).toBeGreaterThan(1);
  expect(coverage.recovered).toBeGreaterThan(1);
  expect(coverage.checks).toBeGreaterThan(0);
});
