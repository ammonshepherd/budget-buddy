/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

// GitHub Pages serves the app from https://ammonshepherd.github.io/budget-buddy/,
// so every URL the build produces starts with this path.
const BASE = "/budget-buddy/";

// Vite is the dev server and bundler. This one file configures the build,
// the PWA plugin and Vitest (which reuses Vite's settings).
export default defineConfig({
  base: BASE,
  define: {
    // Replaced at build time; read through src/models/appInfo.ts.
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [
    react(),
    VitePWA({
      // Generates the service worker and manifest that sw.js and
      // manifest.webmanifest used to provide by hand.
      registerType: "autoUpdate",
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
    // Unit tests live next to the code they test; Playwright owns e2e/.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "integration/**/*.test.ts"],
  },
});
