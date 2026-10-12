import { useEffect, useSyncExternalStore } from "react";
import { parseRoute, ROUTE_TITLES, type Route } from "../models/routes";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const getHash = () => window.location.hash;

/**
 * The current page, taken from the URL hash. `useSyncExternalStore` is
 * React's way to read something that lives outside React (here, the URL)
 * and re-render whenever it changes.
 */
export function useHashRoute(): Route {
  const route = parseRoute(useSyncExternalStore(subscribe, getHash));

  // An effect runs after React has updated the screen: the right place to
  // touch things React does not manage, such as the browser tab title.
  useEffect(() => {
    document.title = `${ROUTE_TITLES[route]} | Budget Buddy`;
  }, [route]);

  return route;
}
