import { useEffect, useSyncExternalStore } from "react";
import { parseLocation, ROUTE_TITLES, type AppLocation } from "../models/routes";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const getHash = () => window.location.hash;

/**
 * The current page (and Budget month), taken from the URL hash. `useSyncExternalStore` is
 * React's way to read something that lives outside React (here, the URL)
 * and re-render whenever it changes.
 */
export function useHashRoute(): AppLocation {
  const location = parseLocation(useSyncExternalStore(subscribe, getHash));
  const { route } = location;

  // An effect runs after React has updated the screen: the right place to
  // touch things React does not manage, such as the browser tab title.
  useEffect(() => {
    document.title = `${ROUTE_TITLES[route]} | Budget Buddy`;
  }, [route]);

  return location;
}
