import { readFileSync } from "node:fs";

import type { NetworkFixture } from "@msw/playwright";
import { http, HttpResponse } from "msw";

export interface EvalFileFixture {
  /** Path of the `.eval` file on disk. */
  path: URL;
  /** Name the log is listed under. */
  logFile: string;
  /** Log-list preview fields (the listing never reads the zip). */
  preview: { task: string; model: string; status: string };
}

/**
 * Serve real `.eval` files through the view-server API — log-info plus
 * byte-range reads — so the viewer opens them exactly as it opens a log from
 * `inspect view`: parsing the zip, header and samples in the browser.
 */
export function serveEvalFiles(
  network: NetworkFixture,
  fixtures: EvalFileFixture[]
) {
  const bytesByFile = new Map(
    fixtures.map((fixture) => [fixture.logFile, readFileSync(fixture.path)])
  );
  const bytesFor = (file: string | readonly string[] | undefined) => {
    // Requests name the file by its path under the log dir.
    const name = decodeURIComponent(String(file)).split("/").pop() ?? "";
    const bytes = bytesByFile.get(name);
    if (!bytes) {
      throw new Error(`No eval fixture served as ${name}`);
    }
    return bytes;
  };

  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: fixtures.map((fixture) => ({
          name: fixture.logFile,
          task: fixture.preview.task,
          task_id: fixture.preview.task,
        })),
        response_type: "full",
      })
    ),
    http.get("*/api/log-headers*", ({ request }) => {
      const requested = new URL(request.url).searchParams.getAll("file");
      return HttpResponse.json(
        fixtures
          .filter((fixture) => requested.includes(fixture.logFile))
          .map((fixture) => ({
            version: 2,
            status: fixture.preview.status,
            eval: {
              eval_id: fixture.logFile,
              run_id: fixture.logFile,
              task: fixture.preview.task,
              task_id: fixture.preview.task,
              task_version: 0,
              model: fixture.preview.model,
              created: "2026-01-01T00:00:00+00:00",
              dataset: {},
              config: {},
            },
          }))
      );
    }),
    http.get("*/api/log-info/:file", ({ params }) =>
      HttpResponse.json({ size: bytesFor(params.file).length })
    ),
    http.get("*/api/log-bytes/:file", ({ params, request }) => {
      const bytes = bytesFor(params.file);
      const url = new URL(request.url);
      const start = Number(url.searchParams.get("start"));
      // The server's range end is inclusive.
      const end = Number(url.searchParams.get("end"));
      return new HttpResponse(bytes.subarray(start, end + 1), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    })
  );
}
