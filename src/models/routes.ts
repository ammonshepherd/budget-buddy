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
  /**
   * The month from "#budget/2026-10" or "#activity/2026-10", or null to use
   * the month last chosen (else the current month).
   */
  month: Month | null;
}

/** Pages that show one month, kept in the URL. */
export const MONTH_ROUTES: readonly Route[] = ["budget", "activity"];

/** Reads a location hash such as "#Accounts" or "#activity/2026-10"; anything unknown means Budget. */
export function parseLocation(hash: string): AppLocation {
  const [name = "", month = ""] = hash.replace(/^#\/?/, "").toLowerCase().split("/");
  const route = ROUTES.find((r) => r === name) ?? "budget";
  return { route, month: MONTH_ROUTES.includes(route) && isMonth(month) ? month : null };
}

export function budgetHref(month: Month): string {
  return `#budget/${month}`;
}

export function activityHref(month: Month): string {
  return `#activity/${month}`;
}

/** A link to a page: Budget and Activity carry the month, so it stays the same between them. */
export function routeHref(route: Route, month: Month): string {
  return MONTH_ROUTES.includes(route) ? `#${route}/${month}` : `#${route}`;
}
