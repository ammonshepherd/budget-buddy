import { useEffect, useSyncExternalStore } from "react";
import { locationHash, parseLocation, ROUTE_TITLES, type AppLocation } from "../models/routes";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const getHash = () => window.location.hash;

/**
 * The current page (its month, and what Accounts has open), taken from the URL hash. `useSyncExternalStore` is
 * React's way to read something that lives outside React (here, the URL)
 * and re-render whenever it changes.
 */
export function useHashRoute(): AppLocation {
  const hash = useSyncExternalStore(subscribe, getHash);
  const location = parseLocation(hash);
  const { route } = location;

  // An old link (#activity/2026-10) shows its new address (#accounts/all/2026-10),
  // replacing the old one in the history so Back does not return to it.
  const legacy = /^#\/?activity/i.test(hash);
  useEffect(() => {
    if (legacy) window.history.replaceState(null, "", locationHash(location));
  });

  // An effect runs after React has updated the screen: the right place to
  // touch things React does not manage, such as the browser tab title.
  useEffect(() => {
    document.title = `${ROUTE_TITLES[route]} | Budget Buddy`;
  }, [route]);

  return location;
}
