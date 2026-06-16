import type { Meta, StoryObj } from "@storybook/react";
import { http, HttpResponse } from "msw";
import type { EvalLog } from "@tsmono/inspect-common/types";

import { withMockedApp } from "../mocks/story-decorator";
import { withDefaults } from "../mocks/handlers";
import {
  createEvalHeader,
  createEvalLog,
  createEvalSample,
  createLogDetails,
} from "../mocks/factories";
import completedEvalFixture from "../mocks/fixtures/completed-eval.json";

const LOG_FILE = "demo.json";
const ENCODED_LOG = encodeURIComponent(LOG_FILE);

const logFileHandlers = (evalLog: EvalLog) => {
  const logDetails = createLogDetails(evalLog);
  const header = createEvalHeader({
    eval: logDetails.eval,
    status: logDetails.status,
    error: logDetails.error ?? undefined,
    stats: logDetails.stats,
  });
  return withDefaults([
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: logDetails.eval.task, task_id: logDetails.eval.task_id }],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", () => HttpResponse.json(evalLog)),
    http.get("*/api/log-headers*", () => HttpResponse.json([header])),
  ]);
};

// The decorator renders <App api={api}/> itself — no args needed.
const meta: Meta = {
  title: "App/FullApp",
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withMockedApp],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// LogListing: shows a directory of log files
// ---------------------------------------------------------------------------

export const LogListing: Story = {
  parameters: {
    initialRoute: "/",
    msw: {
      handlers: withDefaults([
        http.get("*/api/logs", () =>
          HttpResponse.json({
            log_dir: "/home/test/logs",
            logs: [
              { name: "run-a.json", task: "math-eval", task_id: "task-a" },
              { name: "run-b.json", task: "code-eval", task_id: "task-b" },
              { name: "run-c.json", task: "reasoning", task_id: "task-c" },
            ],
          })
        ),
        http.get("*/api/log-files*", () =>
          HttpResponse.json({
            files: [
              { name: "run-a.json", task: "math-eval", task_id: "task-a" },
              { name: "run-b.json", task: "code-eval", task_id: "task-b" },
              { name: "run-c.json", task: "reasoning", task_id: "task-c" },
            ],
            response_type: "full",
          })
        ),
        // Selecting a task in the listing loads that log's contents
        http.get("*/api/logs/:file", () =>
          HttpResponse.json(
            createEvalLog({
              samples: [
                createEvalSample({
                  id: 1,
                  epoch: 1,
                  messages: [
                    { role: "user", content: "Listing demo sample", source: "input" },
                  ],
                }),
              ],
            })
          )
        ),
        http.get("*/api/log-headers*", () =>
          HttpResponse.json([
            createEvalHeader({ eval: { eval_id: "eval-a", run_id: "run-a", task: "math-eval", task_id: "task-a" }, stats: { started_at: "2025-01-15T09:00:00Z", completed_at: "2025-01-15T09:05:00Z" } }),
            createEvalHeader({ eval: { eval_id: "eval-b", run_id: "run-b", task: "code-eval", task_id: "task-b" }, stats: { started_at: "2025-01-15T10:00:00Z", completed_at: "2025-01-15T10:08:00Z" } }),
            createEvalHeader({ eval: { eval_id: "eval-c", run_id: "run-c", task: "reasoning", task_id: "task-c" }, status: "error", stats: { started_at: "2025-01-15T11:00:00Z", completed_at: "2025-01-15T11:01:00Z" } }),
          ])
        ),
      ]),
    },
  },
};

// ---------------------------------------------------------------------------
// CompletedEvalSynthetic: sample messages tab with tool call + reasoning
// ---------------------------------------------------------------------------

const syntheticSample = createEvalSample({
  id: 1,
  epoch: 1,
  messages: [
    { role: "user", content: "List files in the /tmp directory.", source: "input" },
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          reasoning: "The user wants a directory listing. I should use bash to run ls.",
          signature: null,
          redacted: false,
        },
        { type: "text", text: "I'll check the directory for you." },
      ],
      source: "generate",
      id: "msg-a1",
      tool_calls: [
        {
          id: "call_ls",
          type: "function",
          function: "bash",
          arguments: { cmd: "ls /tmp" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_ls",
      content: "file1.txt\nfile2.txt\nscript.sh",
      id: "msg-t1",
    },
    {
      role: "assistant",
      content: "The /tmp directory contains: file1.txt, file2.txt, script.sh.",
      source: "generate",
    },
  ],
});

const syntheticLog = createEvalLog({ samples: [syntheticSample] });

export const CompletedEvalSynthetic: Story = {
  parameters: {
    initialRoute: `/logs/${ENCODED_LOG}/samples/sample/1/1/messages`,
    msw: {
      handlers: logFileHandlers(syntheticLog),
    },
  },
};

// ---------------------------------------------------------------------------
// CompletedEvalRealData: real Python fixture from tests/
// ---------------------------------------------------------------------------

// Cast at import boundary — fixture predates some schema fields (e.g. eval_id)
const realEvalLog = completedEvalFixture as unknown as EvalLog;

export const CompletedEvalRealData: Story = {
  parameters: {
    initialRoute: `/logs/${ENCODED_LOG}/samples/sample/1/1/messages`,
    msw: {
      handlers: withDefaults([
        http.get("*/api/log-files*", () =>
          HttpResponse.json({
            files: [{ name: LOG_FILE, task: "input_task", task_id: "8zXjbRzCWrL9GXiXo2vus9" }],
            response_type: "full",
          })
        ),
        http.get("*/api/logs/:file", () => HttpResponse.json(realEvalLog)),
        http.get("*/api/log-headers*", () =>
          HttpResponse.json([
            createEvalHeader({
              eval: { eval_id: "real-eval-001", run_id: "2BnNsHEspZ94qvnbpxq9wJ", task: "input_task", task_id: "8zXjbRzCWrL9GXiXo2vus9", task_version: 0, model: "openai/gpt-4o-mini" },
              stats: { started_at: "2024-11-05T13:31:45-05:00", completed_at: "2024-11-05T13:32:19-05:00" },
            }),
          ])
        ),
      ]),
    },
  },
};

// ---------------------------------------------------------------------------
// RunningEval: polling /pending-samples until completion
// ---------------------------------------------------------------------------

export const RunningEval: Story = {
  parameters: {
    initialRoute: `/logs/${ENCODED_LOG}`,
    msw: {
      handlers: (() => {
        // Closure counter resets each render since the story object is re-evaluated
        let callCount = 0;
        const K = 3; // Return pending samples for the first K calls

        const runningSample = createEvalSample({
          id: 1,
          epoch: 1,
          messages: [{ role: "user", content: "Running eval sample", source: "input" }],
        });

        const startedLog = createEvalLog({
          samples: [runningSample],
          status: "started",
          eval: { task: "running-task", task_id: "running-001" },
        });

        const completedLog = createEvalLog({
          samples: [runningSample],
          status: "success",
          eval: { task: "running-task", task_id: "running-001" },
        });

        return withDefaults([
          http.get("*/api/log-files*", () =>
            HttpResponse.json({
              files: [{ name: LOG_FILE, task: "running-task", task_id: "running-001" }],
              response_type: "full",
            })
          ),
          http.get("*/api/logs/:file", () => {
            const current = callCount;
            return HttpResponse.json(current < K ? startedLog : completedLog);
          }),
          http.get("*/api/log-headers*", () =>
            HttpResponse.json([
              createEvalHeader({
                eval: { eval_id: "eval-running", run_id: "run-running", task: "running-task", task_id: "running-001" },
                status: "started",
                stats: { started_at: new Date().toISOString(), completed_at: undefined },
              }),
            ])
          ),
          http.get("*/api/pending-samples*", () => {
            callCount += 1;
            if (callCount <= K) {
              return HttpResponse.json({
                status: "OK",
                pendingSamples: {
                  samples: [
                    {
                      id: 1,
                      epoch: 1,
                      input: "Running eval sample",
                      target: "",
                      scores: null,
                      metadata: {},
                      completed: false,
                    },
                  ],
                  refresh: 1,
                  etag: `etag-${callCount}`,
                },
              });
            }
            return new HttpResponse(null, { status: 404 });
          }),
        ]);
      })(),
    },
  },
};

// ---------------------------------------------------------------------------
// ErrorState: eval that ended in error
// ---------------------------------------------------------------------------

const errorLog = createEvalLog({
  status: "error",
  error: {
    message: "Task failed: sandbox connection timed out after 30s",
    traceback: "Traceback (most recent call last):\n  File 'task.py', line 42, in run\n    raise TimeoutError('sandbox connection timed out after 30s')\nTimeoutError: sandbox connection timed out after 30s",
    traceback_ansi: "Traceback (most recent call last):\n  File 'task.py', line 42, in run\n    raise TimeoutError('sandbox connection timed out after 30s')\nTimeoutError: sandbox connection timed out after 30s",
  },
});

export const ErrorState: Story = {
  parameters: {
    initialRoute: `/logs/${ENCODED_LOG}`,
    msw: {
      handlers: withDefaults([
        http.get("*/api/log-files*", () =>
          HttpResponse.json({
            files: [{ name: LOG_FILE, task: "error-task", task_id: "error-001" }],
            response_type: "full",
          })
        ),
        http.get("*/api/logs/:file", () => HttpResponse.json(errorLog)),
        http.get("*/api/log-headers*", () =>
          HttpResponse.json([
            {
              eval_id: "eval-error",
              run_id: "run-error",
              task: "error-task",
              task_id: "error-001",
              task_version: 1,
              model: "claude-sonnet-4-5-20250929",
              status: "error",
              started_at: "2025-01-15T12:00:00Z",
              completed_at: "2025-01-15T12:00:30Z",
            },
          ])
        ),
      ]),
    },
  },
};
