import { defineConfig, devices } from "@playwright/test";

// Dedicated e2e ports: 5173/5174 are the two apps' dev servers and 5175/5177
// inspect's e2e servers; reuseExistingServer would silently test the wrong app.
// Most specs use a production build, which `vite preview` serves with the
// viewer's Content-Security-Policy, as `scout view` does.
const previewURL = "http://localhost:5176";
// Tests tagged @dev-server drive harness pages under e2e/fixtures, which
// only the dev server serves.
const devServerURL = "http://localhost:5178";
const devServerTag = /@dev-server/;

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
      use: { ...devices["Desktop Chrome"], baseURL: previewURL },
    },
    {
      name: "chromium-dev-server",
      grep: devServerTag,
      use: { ...devices["Desktop Chrome"], baseURL: devServerURL },
    },
  ],
  webServer: [
    {
      command:
        "pnpm exec vite build --mode e2e && pnpm exec vite preview --mode e2e --port 5176 --strictPort",
      url: previewURL,
      // A reused server would serve a stale build; fail on the port instead.
      reuseExistingServer: false,
    },
    {
      command: "pnpm dev --port 5178",
      url: devServerURL,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
