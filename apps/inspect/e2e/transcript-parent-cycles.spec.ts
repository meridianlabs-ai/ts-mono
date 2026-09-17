import {
  testModelEvent,
  testSpanBeginEvent,
  testTimelineEvent,
  testTimelineSpan,
} from "@tsmono/inspect-common/testing";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

test("cyclic orphan spans display an error without freezing the viewer", async ({
  page,
  network,
}) => {
  const sample = createEvalSample({ id: 1, epoch: 1, messages: [] });
  sample.events = [
    testModelEvent({ uuid: "referenced" }),
    testSpanBeginEvent({ id: "cycle", parent_id: "cycle" }),
    testModelEvent({ uuid: "orphan", span_id: "cycle" }),
  ];
  sample.timelines = [
    {
      name: "Server timeline",
      description: "Authored transcript",
      root: testTimelineSpan({
        id: "server-root",
        content: [testTimelineEvent({ event: "referenced" })],
      }),
    },
  ];
  const file = "cyclic-spans.json";
  serveEvalLog(network, createEvalLog({ samples: [sample] }), file);

  await page.goto(`/#/logs/${file}/samples/sample/1/1/transcript`);

  await expect(page.getByTestId("error-panel")).toContainText(
    'Invalid transcript: cyclic span parent chain at "cycle".'
  );
  expect(
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(() => resolve("responsive"), 0))
    )
  ).toBe("responsive");
});
