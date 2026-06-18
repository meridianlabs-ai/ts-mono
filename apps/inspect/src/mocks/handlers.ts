import { http, HttpResponse, type RequestHandler } from "msw";

import type { AppConfig } from "@tsmono/inspect-common/types";

/**
 * Default handlers that let the inspect app boot cleanly.
 *
 * The view-server API prefixes all routes with /api (proxied via vite in dev).
 * On boot the app calls: /api/app-config, /api/events, /api/log-dir, /api/logs
 * (bare, for initLogDir), /api/log-files, /api/log-headers, and eventually
 * /api/logs/{file}?header-only=100 for a specific log.
 *
 * Note: MSW treats /api/logs and /api/logs/:file as disjoint patterns, so
 * this bare handler does NOT shadow per-file story overrides.
 */
export const defaultHandlers = [
  // App config — App.tsx gates rendering on this resolving
  http.get("*/api/app-config", () => {
    return HttpResponse.json<AppConfig>({
      inspect_version: "0.0.0-e2e",
      scout_version: null,
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

  // Log root — called by initLogDir on every boot (GET /api/logs or
  // /api/logs?log_dir=...). Returns an empty listing by default; per-story
  // handlers that override /api/log-files should also override this if they
  // want the listing to match.
  http.get("*/api/logs", () => {
    return HttpResponse.json({
      logs: [],
      log_dir: "/home/test/logs",
    });
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

/**
 * Layer story-specific handlers over the boot defaults.
 *
 * Storybook REPLACES `parameters.msw.handlers` arrays per story rather than
 * concatenating them with the global preview handlers, so a story that sets
 * its own handlers would otherwise lose every boot endpoint (/api/events,
 * /api/log-dir, bare /api/logs, ...) and 404 on bootstrap. Overrides come
 * first because MSW matches first-registered-wins; defaults are the fallback.
 */
export const withDefaults = (overrides: RequestHandler[]): RequestHandler[] => [
  ...overrides,
  ...defaultHandlers,
];
