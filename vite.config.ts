/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

// GitHub Pages serves the app from https://ammonshepherd.github.io/budget-buddy/,
// so every URL the build produces starts with this path.
const BASE = "/budget-buddy/";

// The test Supabase project (see docs/testing.md); production is lkaurrcarzzkbqdwqfge.
const TEST_PROJECT_REF = "kiqbgjgvptgknmboazaq";

/**
 * Stops a build that would ship a secret or point production at the test
 * database. Only VITE_ variables reach the browser, so a secret must never
 * have that prefix.
 */
function checkBuildEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const secret = Object.keys(env).find((name) => /SERVICE_ROLE|SECRET|PASSWORD/i.test(name));
  if (secret) throw new Error(`${secret} would be bundled into the app; remove the VITE_ prefix.`);
  if (mode === "production" && env.VITE_SUPABASE_URL?.includes(TEST_PROJECT_REF)) {
    throw new Error("The production build points at the test Supabase project.");
  }
}

/**
 * The built page's Content Security Policy: the browser runs only the app's
 * own scripts and styles and talks only to the app and its Supabase project,
 * so injected code could neither load more code nor send data elsewhere.
 * GitHub Pages cannot send headers, so it goes in a <meta> tag. Build only:
 * the dev server injects inline scripts for hot reload.
 */
function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  const supabase = supabaseUrl ? ` ${new URL(supabaseUrl).origin}` : "";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${supabase}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function cspPlugin(mode: string): Plugin {
  // loadEnv also picks up VITE_ variables set in the shell (CI, Playwright).
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const supabaseUrl = env.VITE_DATA_STORE === "memory" ? undefined : env.VITE_SUPABASE_URL;
  return {
    name: "budget-buddy-csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: contentSecurityPolicy(supabaseUrl),
        },
        injectTo: "head-prepend",
      },
    ],
  };
}

// Vite is the dev server and bundler. This one file configures the build,
// the PWA plugin and Vitest (which reuses Vite's settings). `mode` is
// "production" for `vite build`, "development" for `vite`, and "test" with
// `--mode test`, which loads .env.test (the test database).
export default defineConfig(({ command, mode }) => {
  if (command === "build") checkBuildEnv(mode);
  return {
    base: BASE,
    define: {
      // Replaced at build time; read through src/models/appInfo.ts.
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    plugins: [
      react(),
      cspPlugin(mode),
      VitePWA({
        // Generates the service worker and manifest that sw.js and
        // manifest.webmanifest used to provide by hand.
        // "prompt": a new build waits until the user taps Refresh on the
        // new version banner (src/controllers/useAppUpdate.ts), so the app
        // never reloads in the middle of an edit.
        registerType: "prompt",
        // Cached by the service worker so the icons work offline.
        includeAssets: [
          "icons/favicon.svg",
          "icons/favicon-32.png",
          "icons/favicon.ico",
          "icons/apple-touch-icon.png",
          "icons/icon.svg",
        ],
        manifest: {
          name: "Budget Buddy",
          short_name: "Budget Buddy",
          description: "A simple envelope-style budgeting app.",
          start_url: BASE,
          scope: BASE,
          id: BASE,
          display: "standalone",
          background_color: "#faf8fc",
          theme_color: "#4b2a68",
          // "any" icons are shown as drawn; the "maskable" one has extra
          // padding so Android can crop it to a circle or rounded square.
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "icons/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
            { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          ],
        },
      }),
    ],
    test: {
      // Two groups ("projects"): unit tests need no database; integration tests
      // run against the test database and reseed it first. Playwright owns e2e/.
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "integration",
            include: ["integration/**/*.test.ts"],
            globalSetup: ["integration/globalSetup.ts"],
            // The files share two test users, so they run one at a time.
            fileParallelism: false,
            testTimeout: 30_000,
            hookTimeout: 60_000,
          },
        },
      ],
    },
  };
});
