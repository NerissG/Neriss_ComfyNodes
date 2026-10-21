import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 30_000,
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "./test-results",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4179",
    viewport: { width: 1674, height: 1010 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // Launch Vite directly so normal test teardown does not produce a pnpm failure banner.
    command: "node node_modules/vite/bin/vite.js --config vite.preview.config.ts",
    url: "http://127.0.0.1:4179/preview/index.html",
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
  projects: [
    { name: "preflight", testMatch: "preflight.spec.ts" },
    { name: "chromium", testMatch: ["editor.spec.ts", "hardening.spec.ts"], dependencies: ["preflight"] },
  ],
});
