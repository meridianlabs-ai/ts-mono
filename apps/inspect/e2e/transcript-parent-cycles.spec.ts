import {
  testModelEvent,
  testSpanBeginEvent,
  testTimelineEvent,
  testTimelineSpan,
} from "@tsmono/inspect-common/testing";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import {
  createEvalLog,
  createEvalSample,
  createModelOutput,
} from "./fixtures/test-data";

test("cyclic orphan spans keep their events visible and allow navigation", async ({
  page,
  network,
}) => {
  const sample = createEvalSample({
    id: 1,
    epoch: 1,
    messages: [],
    events: [
      testModelEvent({
        uuid: "referenced",
        output: createModelOutput("Referenced response"),
      }),
      testSpanBeginEvent({ id: "cycle", parent_id: "cycle" }),
      testModelEvent({
        uuid: "orphan",
        span_id: "cycle",
        output: createModelOutput("Recovered orphan response"),
      }),
    ],
    timelines: [
      {
        name: "Server timeline",
        description: "Authored transcript",
        root: testTimelineSpan({
          id: "server-root",
          content: [testTimelineEvent({ event: "referenced" })],
        }),
      },
    ],
  });
  const nextSample = createEvalSample({
    id: 2,
    epoch: 1,
    messages: [],
    events: [
      testModelEvent({ output: createModelOutput("Next sample response") }),
    ],
  });
  const file = "cyclic-spans.json";
  serveEvalLog(network, createEvalLog({ samples: [sample, nextSample] }), file);

  await page.goto(`/#/logs/${file}/samples/sample/1/1/transcript`);

  await expect(page.getByText("Referenced response").first()).toBeVisible();
  await expect(
    page.getByText("Recovered orphan response").first()
  ).toBeVisible();
  await expect(page.getByTestId("error-panel")).toHaveCount(0);

  await page.evaluate(() => {
    window.location.hash =
      "/logs/cyclic-spans.json/samples/sample/2/1/transcript";
  });
  await expect(page.getByText("Next sample response").first()).toBeVisible();
});
