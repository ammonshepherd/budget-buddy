import { defineConfig, devices } from "@playwright/test";

// Playwright drives a real browser against the production build
// (`vite preview`), so UI tests see what users get.
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4173/" },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
  },
});
