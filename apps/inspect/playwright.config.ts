import { defineConfig, devices } from "@playwright/test";

// 5175: dedicated e2e port — 5173/5174 are taken by the two apps' dev
// servers, and reuseExistingServer would silently test the wrong app.
const baseURL = "http://localhost:5175";
// 5177: the production build under its CSP (e2e/csp), which the dev server
// can't exercise: it ships no policy.
const cspBaseURL = "http://localhost:5177";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "csp/**",
      use: { ...devices["Desktop Chrome"], baseURL },
    },
    {
      name: "csp",
      testMatch: "csp/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: cspBaseURL },
    },
  ],
  webServer: [
    {
      command: "pnpm dev --port 5175",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        "pnpm exec vite build --outDir e2e-dist && pnpm exec vite preview --outDir e2e-dist --port 5177 --strictPort",
      url: cspBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
