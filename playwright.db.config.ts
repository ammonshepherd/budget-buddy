import { defineConfig, devices } from "@playwright/test";
import { missingForTests, readTestEnv } from "./scripts/testEnv";
import { assertTestTarget } from "./scripts/testTarget";

// UI tests against the test database (npm run test:ui:db), signed in as test
// user A. The everyday UI tests (playwright.config.ts) use the in-memory store
// and need no database. This build gets the test project's URL and
// publishable key passed in directly, so it can never fall back to the
// production values in .env.local. Run `npm run db:seed:test` first.
const env = readTestEnv();
const configured = !missingForTests(env);
if (configured) assertTestTarget(env.url);

export default defineConfig({
  testDir: "./e2e-db",
  // The specs share one test user and its data.
  workers: 1,
  use: { baseURL: "http://localhost:4174/budget-buddy/" },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  // Without a test database the specs skip, so nothing needs building.
  webServer: configured
    ? {
        command:
          "vite build --mode test --outDir dist-e2e-db && vite preview --mode test --outDir dist-e2e-db --port 4174 --strictPort",
        url: "http://localhost:4174/budget-buddy/",
        reuseExistingServer: !process.env.CI,
        env: { VITE_SUPABASE_URL: env.url, VITE_SUPABASE_ANON_KEY: env.anonKey },
      }
    : undefined,
});
