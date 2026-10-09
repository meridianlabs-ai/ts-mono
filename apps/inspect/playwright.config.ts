import { defineConfig, devices } from "@playwright/test";

// Dedicated e2e ports — 5173/5174 are the two apps' dev servers and 5176 is
// scout's e2e server; reuseExistingServer would silently test the wrong app.
// Most tests use a production build, which loads about twice as fast.
const previewURL = "http://localhost:5175";
// Tests tagged @dev-server inspect individual source modules, which only the
// dev server serves.
const devServerURL = "http://localhost:5177";
const devServerTag = /@dev-server/;

const chromium = { ...devices["Desktop Chrome"], channel: "chromium" };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // GitHub's ubuntu-latest runners for public repos have 4 vCPUs.
  workers: process.env.CI ? 4 : undefined,
  reporter: "html",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      grepInvert: devServerTag,
      use: { ...chromium, baseURL: previewURL },
    },
    {
      name: "chromium-dev-server",
      grep: devServerTag,
      use: { ...chromium, baseURL: devServerURL },
    },
  ],
  webServer: [
    {
      command:
        "pnpm exec vite build --mode e2e && pnpm exec vite preview --mode e2e --port 5175 --strictPort",
      url: previewURL,
      // A reused server would serve a stale build; fail on the port instead.
      reuseExistingServer: false,
    },
    {
      command: "pnpm dev --port 5177",
      url: devServerURL,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
