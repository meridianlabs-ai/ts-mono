import { homedir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const viewerPort = process.env.VERIFY_VIEWER_PORT ?? "5179";
const viewServerPort = process.env.VERIFY_VIEW_SERVER_PORT ?? "7677";
const baseURL = `http://localhost:${viewerPort}`;

// `inspect` must be an inspect_ai CLI; see SKILL.md → Launch for where one
// lives on this machine if it isn't on PATH.
const inspectBin = process.env.INSPECT_BIN ?? "inspect";
const logDir =
  process.env.VERIFY_LOG_DIR ?? join(homedir(), "code/viewer-validation/logs");

const skillDir = import.meta.dirname;
const appDir = join(skillDir, "../../..");

export default defineConfig({
  testDir: join(skillDir, "drive"),
  outputDir: join(skillDir, "test-results"),
  fullyParallel: false,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // reuseExistingServer stays false on both: a port already owned by
  // something else means we'd be driving (and possibly corrupting) a
  // session we didn't start — refuse instead.
  webServer: [
    {
      command: `${inspectBin} view start --log-dir ${logDir} --port ${viewServerPort} --display plain`,
      url: `http://127.0.0.1:${viewServerPort}/api/logs`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec vite --config ${join(skillDir, "vite.verify.config.ts")}`,
      cwd: appDir,
      env: {
        VERIFY_VIEWER_PORT: viewerPort,
        VERIFY_VIEW_SERVER_PORT: viewServerPort,
      },
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
