import { delay, http, HttpResponse } from "msw";

import {
  testModelEvent,
  testScore,
  testToolEvent,
} from "@tsmono/inspect-common/testing";

import { runBombadil } from "../../../../tooling/bombadil/run.mjs";
import { expect, test } from "../fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
  createModelOutput,
} from "../fixtures/test-data";

const marker = "document.documentElement.dataset.bombadilExecuted='yes'";
const payloads = [
  `<img src=x onerror="${marker}">`,
  `<svg onload="${marker}"></svg>`,
  `[unsafe](javascript:${marker})`,
  `[unsafe](data:text/html,<script>${marker}</script>)`,
  `$\\href{javascript:${marker}}{unsafe}$`,
  `$\\href{x"><animate onbegin=${marker}>}{z}$`,
  "![remote](https://bombadil.invalid/pixel.png)",
  `<iframe srcdoc="<script>${marker}</script>"></iframe>`,
];

test("sample identity and hostile content", async ({
  page,
  network,
}, testInfo) => {
  let forbiddenRequests = 0;
  // No action in this campaign authorizes a write or an external fetch.
  await page.route("https://bombadil.invalid/**", async (route) => {
    forbiddenRequests += 1;
    await route.abort();
  });
  const logs = ["red", "blue"].map((color) => ({
    file: `${color}.json`,
    log: createEvalLog({
      eval: {
        eval_id: `eval-${color}`,
        task: `Task ${color}`,
        task_id: color,
        model: `model-${color}`,
      },
      samples: [1, 2].flatMap((epoch) =>
        payloads.map((payload, index) => {
          const content = `EVIDENCE_${color}_${index}_${epoch}\n\n${payload}`;
          const sample = createEvalSample({
            id: index,
            epoch,
            messages: [{ role: "assistant", id: `message-${index}`, content }],
            metadata: { explanation: payload },
            events: [
              testModelEvent({
                uuid: `model-${index}`,
                output: createModelOutput(content),
              }),
              testToolEvent({
                uuid: `tool-${index}`,
                function: "test",
                result: content,
              }),
            ],
          });
          sample.scores = {
            correctness: testScore({
              value: color === "red" ? 0 : 1,
              explanation: content,
            }),
          };
          return sample;
        })
      ),
    }),
  }));
  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: logs.map(({ file, log }) => ({
          name: file,
          task: log.eval.task,
          task_id: log.eval.task_id,
        })),
        response_type: "full",
      })
    ),
    http.get("*/api/log-headers*", ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.getAll("file").flatMap((file) => {
          const entry = logs.find(
            (item) => file === item.file || file.endsWith(`/${item.file}`)
          );
          return entry ? [createLogDetails(entry.log)] : [];
        })
      )
    ),
    http.get("*/api/logs/:file", async ({ params }) => {
      const entry = logs.find(
        ({ file }) =>
          file === params.file ||
          (typeof params.file === "string" && params.file.endsWith(`/${file}`))
      );
      await delay(entry?.file === "red.json" ? 350 : 50);
      return entry
        ? HttpResponse.json(entry.log)
        : new HttpResponse(null, { status: 404 });
    }),
    http.all("*/api/log-message*", () => {
      forbiddenRequests += 1;
      return new HttpResponse(null, { status: 403 });
    })
  );
  await page.goto("/#/logs/red.json/samples/sample/0/1/messages");
  await expect(
    page.getByText("EVIDENCE_red_0_1", { exact: true }).first()
  ).toBeVisible();
  const { code, log } = await runBombadil({
    origin: "http://localhost:5185",
    specification: "e2e/bombadil/inspect.ts",
    output: testInfo.outputPath("bombadil"),
    debuggerPort: 9334,
  });
  expect(code, log.slice(-8000)).toBe(0);
  expect(forbiddenRequests).toBe(0);
});
