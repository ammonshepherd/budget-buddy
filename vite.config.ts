/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

// Vite is the dev server and bundler. This one file configures the build,
// the PWA plugin and Vitest (which reuses Vite's settings).
export default defineConfig({
  // Relative paths so the built app works from a GitHub Pages sub-folder.
  base: "./",
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
      includeAssets: ["icons/logo-icon.svg", "icons/logo-icon.png"],
      manifest: {
        name: "Budget Buddy",
        short_name: "Budget Buddy",
        description: "A simple envelope-style budgeting app.",
        start_url: "./",
        scope: "./",
        id: "./",
        display: "standalone",
        background_color: "#faf8fc",
        theme_color: "#4b2a68",
        icons: [
          {
            src: "icons/logo-icon.png",
            sizes: "1024x1024",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "icons/logo-icon.svg",
            sizes: "256x256",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  test: {
    // Unit tests live next to the code they test; Playwright owns e2e/.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
