import { useCallback } from "react";
// A "virtual" module: vite-plugin-pwa writes it at build time. It registers
// the service worker and tells us when a newer build has downloaded.
import { useRegisterSW } from "virtual:pwa-register/react";

/** How often an open app asks GitHub Pages for a newer build. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Notices a new deploy while the app is open. The browser only looks for a
 * new service worker when a page loads, and hash routing never reloads, so
 * this also checks every hour and whenever the app comes back on screen.
 *
 * `ready` is true once the new version is downloaded and waiting. `refresh`
 * swaps it in and reloads; `dismiss` hides the offer until the next check.
 */
export function useAppUpdate(): { ready: boolean; refresh: () => void; dismiss: () => void } {
  const {
    needRefresh: [ready, setReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (registration.installing || !navigator.onLine) return;
        // Fails quietly offline or when Pages is unreachable; the next check retries.
        registration.update().catch(() => undefined);
      };
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });

  const refresh = useCallback(() => void updateServiceWorker(true), [updateServiceWorker]);
  const dismiss = useCallback(() => setReady(false), [setReady]);
  return { ready, refresh, dismiss };
}
