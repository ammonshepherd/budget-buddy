import { defineConfig, devices } from "playwright/test";
export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node scripts/serve.mjs", url: "http://127.0.0.1:4173", reuseExistingServer: !process.env.CI },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }, { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } }]
});
