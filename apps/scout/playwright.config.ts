import { defineConfig, devices } from "@playwright/test";

// 5176: dedicated e2e port — 5173/5174 are taken by the two apps' dev
// servers, and reuseExistingServer would silently test the wrong app.
const baseURL = "http://localhost:5176";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev --port 5176",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
