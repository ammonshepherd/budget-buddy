import { isMonth, type Month } from "./month";

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

export interface AppLocation {
  route: Route;
  /** The Budget page's month from "#budget/2026-10", or null to use the current month. */
  month: Month | null;
}

/** Reads a location hash such as "#Accounts" or "#budget/2026-10"; anything unknown means Budget. */
export function parseLocation(hash: string): AppLocation {
  const [name = "", month = ""] = hash.replace(/^#\/?/, "").toLowerCase().split("/");
  const route = ROUTES.find((r) => r === name) ?? "budget";
  return { route, month: route === "budget" && isMonth(month) ? month : null };
}

export function budgetHref(month: Month): string {
  return `#budget/${month}`;
}
