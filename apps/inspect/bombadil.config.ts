import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/bombadil",
  testMatch: "*.explore.ts",
  outputDir: ".bombadil-results",
  workers: 1,
  retries: 0,
  timeout: 600_000,
  use: {
    baseURL: "http://localhost:5185",
    launchOptions: { args: ["--remote-debugging-port=9334"] },
  },
  webServer: {
    command: "pnpm dev --port 5185",
    url: "http://localhost:5185",
    reuseExistingServer: !process.env.CI,
  },
});
