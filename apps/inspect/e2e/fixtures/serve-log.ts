import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { NetworkFixture } from "@msw/playwright";
import { http, HttpResponse } from "msw";

import type {
  ChatMessage,
  EvalLog,
  FindMessagesRequest,
  FindMessagesResponse,
} from "@tsmono/inspect-common/types";

import { createLogDetails } from "./test-data";

/** Matching rows per find page. Small, so a 250-message log takes several
 *  pages and the band's M+ → M accumulation is exercised. */
export const FIND_PAGE_ROWS = 40;
/** A term the fixture answers with HTTP 500, to exercise the band's error state. */
export const FIND_FAILING_TERM = "fixture-500";

/**
 * Route the log-listing and log-content API at a single in-memory eval log,
 * so a spec can deep-link straight into it. With E2E_LOG_DIR set the log is
 * written there instead, for a real `inspect view --log-dir` behind vite's
 * proxy (VIEW_SERVER_URL) — the server then answers everything, find
 * included.
 */
export function serveEvalLog(
  network: NetworkFixture,
  evalLog: EvalLog,
  logFile: string,
  task = "test-task"
) {
  if (process.env.E2E_LOG_DIR) {
    writeFileSync(
      join(process.env.E2E_LOG_DIR, logFile),
      JSON.stringify(evalLog)
    );
    return;
  }
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
    http.post<never, FindMessagesRequest>(
      "*/api/find-messages/*",
      async ({ request }) => {
        const body = await request.json();
        if (body.text === FIND_FAILING_TERM) {
          return HttpResponse.text("boom", { status: 500 });
        }
        const sample = evalLog.samples?.find(
          (s) =>
            String(s.id) === String(body.sample_id) && s.epoch === body.epoch
        );
        return HttpResponse.json(findMessages(sample?.messages ?? [], body));
      }
    ),
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

/**
 * Stand-in for the view server's find over a conversation's source text:
 * case-insensitive substring per row (role header, then content; one row per
 * message — these fixtures have no tool calls to fold), forward paging
 * strictly after `after` with a fixed page size, `at_end` once the scan
 * walked off the last row. Anchors follow `messageRowAnchorIds` (rowsModel):
 * the message id, suffixed with `#index` while taken. Not imported from
 * there — the chat package entry pulls CSS modules Node cannot load.
 */
function findMessages(
  messages: ChatMessage[],
  body: FindMessagesRequest
): FindMessagesResponse {
  const assigned = new Set<string>();
  const anchors = messages.map((message, index) => {
    let anchor = message.id ?? "";
    while (assigned.has(anchor)) anchor += `#${index}`;
    assigned.add(anchor);
    return anchor;
  });
  const unlabeled = body.projection?.unlabeled_roles ?? [];
  const needle = body.text.toLowerCase();
  const page: FindMessagesResponse["rows"] = [];
  const start = body.after ? anchors.indexOf(body.after) + 1 : 0;
  let i = start;
  for (; i < messages.length && page.length < FIND_PAGE_ROWS; i++) {
    const message = messages[i]!;
    const role = unlabeled.includes(message.role) ? "" : message.role;
    const content =
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("");
    const source = role + content;
    const lower = source.toLowerCase();
    const texts = new Set<string>();
    let count = 0;
    for (
      let at = lower.indexOf(needle);
      needle && at !== -1;
      at = lower.indexOf(needle, at + needle.length)
    ) {
      texts.add(source.slice(at, at + needle.length));
      count++;
    }
    if (count > 0) {
      page.push({ anchor: anchors[i]!, index: i, count, texts: [...texts] });
    }
  }
  return { rows: page, at_end: i === messages.length, complete: true };
}
