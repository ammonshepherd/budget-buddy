/** The app's pages. Hash routing (#budget) keeps GitHub Pages happy. */
export const ROUTES = ["budget", "accounts", "activity", "settings"] as const;

/** One of the strings in ROUTES: "budget" | "accounts" | "activity" | "settings". */
export type Route = (typeof ROUTES)[number];

export const ROUTE_TITLES: Record<Route, string> = {
  budget: "Budget",
  accounts: "Accounts",
  activity: "Activity",
  settings: "Settings",
};

/** Reads a location hash such as "#Accounts"; anything unknown means Budget. */
export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, "").toLowerCase();
  return ROUTES.find((route) => route === name) ?? "budget";
}
