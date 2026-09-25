import { defineConfig, devices } from "@playwright/test";

// 5175: dedicated e2e port — 5173/5174 are taken by the two apps' dev
// servers, and reuseExistingServer would silently test the wrong app.
const baseURL = "http://localhost:5175";

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
    {
      // Find specs only: chat-components (math selection), turn-navigation
      // (scroll leak) and viewer-xss (print) already fail on main under Firefox.
      name: "firefox",
      testMatch: /messages-find/,
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    command: "pnpm dev --port 5175",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
