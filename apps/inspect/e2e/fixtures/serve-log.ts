import type { NetworkFixture } from "@msw/playwright";
import { http, HttpResponse } from "msw";

import type { EvalLog } from "@tsmono/inspect-common/types";

import { createLogDetails } from "./test-data";

/**
 * Route the log-listing and log-content API at a single in-memory eval log,
 * so a spec can deep-link straight into it.
 */
export function serveEvalLog(
  network: NetworkFixture,
  evalLog: EvalLog,
  logFile: string,
  task = "test-task"
) {
  const logDetails = createLogDetails(evalLog);
  network.use(
    // get_log_root — the dir-mode gate blocks on this.
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: logFile, task, task_id: task }],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", () => HttpResponse.json(evalLog)),
    http.get("*/api/log-headers*", () =>
      HttpResponse.json([
        {
          eval_id: logDetails.eval.eval_id,
          run_id: logDetails.eval.run_id,
          task: logDetails.eval.task,
          task_id: logDetails.eval.task_id,
          task_version: logDetails.eval.task_version,
          model: logDetails.eval.model,
          status: logDetails.status,
          started_at: logDetails.stats?.started_at,
          completed_at: logDetails.stats?.completed_at,
        },
      ])
    )
  );
}
