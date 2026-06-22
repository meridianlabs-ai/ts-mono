import { http, HttpResponse } from "msw";

import type { AppConfig } from "@tsmono/inspect-common/types";

/**
 * Default handlers that let the inspect app boot cleanly.
 *
 * The view-server API prefixes all routes with /api (proxied via vite in dev).
 * On boot the app calls: /api/app-config, /api/events, /api/log-dir, /api/log-files,
 * /api/log-headers, and eventually /api/logs/{file}?header-only=100 for a
 * specific log.
 */
export const defaultHandlers = [
  http.get("*/api/app-config", () => {
    return HttpResponse.json<AppConfig>({
      inspect_version: "0.0.0-e2e",
      scout_version: null,
      log_dirs: [],
    });
  }),

  // Client events — return empty array so polling doesn't block
  http.get("*/api/events*", () => {
    return HttpResponse.json([]);
  }),

  // Log directory
  http.get("*/api/log-dir", () => {
    return HttpResponse.json({ log_dir: "/home/test/logs" });
  }),

  // Log file listing
  http.get("*/api/log-files*", () => {
    return HttpResponse.json({
      files: [],
      response_type: "full" as const,
    });
  }),

  // Log headers / summaries
  http.get("*/api/log-headers*", () => {
    return HttpResponse.json([]);
  }),

  // Eval set (optional, 404 is acceptable)
  http.get("*/api/eval-set*", () => {
    return new HttpResponse(null, { status: 404 });
  }),

  // Flow (optional, 404 is acceptable)
  http.get("*/api/flow*", () => {
    return new HttpResponse(null, { status: 404 });
  }),
];
