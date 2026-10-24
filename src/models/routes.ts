import { isMonth, type Month } from "./month";

/** The app's pages. Hash routing (#budget) works on any static host. */
export const ROUTES = ["budget", "accounts", "settings"] as const;

/** One of the strings in ROUTES: "budget" | "accounts" | "settings". */
export type Route = (typeof ROUTES)[number];

export const ROUTE_TITLES: Record<Route, string> = {
  budget: "Budget",
  accounts: "Accounts",
  settings: "Settings",
};

/** What the Accounts page has open: nothing (the list), "all" accounts, or one account's id. */
export type AccountsView = "all" | string | null;

export interface AppLocation {
  route: Route;
  /**
   * The month from "#budget/2026-10" or "#accounts/all/2026-10", or null to
   * use the month last chosen (else the current month).
   */
  month: Month | null;
  /** On Accounts, what is open (null: the list). Always null on other pages. */
  account: AccountsView;
}

/** Pages that show one month, kept in the URL. */
export const MONTH_ROUTES: readonly Route[] = ["budget", "accounts"];

/**
 * Reads a location hash such as "#Settings", "#budget/2026-10",
 * "#accounts/all/2026-10" or "#accounts/<account id>"; anything unknown means
 * Budget. The old "#activity" page reads as All accounts.
 */
export function parseLocation(hash: string): AppLocation {
  const parts = hash.replace(/^#\/?/, "").split("/");
  const name = (parts[0] ?? "").toLowerCase();
  // The last part may be a month; whatever sits between is the open account.
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const month = isMonth(last) ? last : null;
  const middle = parts.slice(1, month ? -1 : undefined).filter(Boolean);

  if (name === "activity") return { route: "accounts", month, account: "all" };
  const route = ROUTES.find((r) => r === name) ?? "budget";
  if (route !== "accounts") {
    return { route, month: MONTH_ROUTES.includes(route) ? month : null, account: null };
  }
  const opened = middle[0] ?? null;
  return { route, month, account: opened?.toLowerCase() === "all" ? "all" : opened };
}

/** The hash a location is shown at: old links (#activity) are rewritten to it. */
export function locationHash({ route, month, account }: AppLocation): string {
  if (route === "accounts") return accountsHref(account, month);
  return month && MONTH_ROUTES.includes(route) ? `#${route}/${month}` : `#${route}`;
}

export function budgetHref(month: Month): string {
  return `#budget/${month}`;
}

/** Accounts with nothing open (null), All accounts ("all") or one account open, with the month. */
export function accountsHref(account: AccountsView, month: Month | null): string {
  const parts = ["accounts", account, month].filter(Boolean);
  return `#${parts.join("/")}`;
}

/** A link to a page: Budget and Accounts carry the month, so it stays the same between them. */
export function routeHref(route: Route, month: Month): string {
  return MONTH_ROUTES.includes(route) ? `#${route}/${month}` : `#${route}`;
}

/** Sections of Settings a link can go straight to ("#settings/groups"). */
export type SettingsSection = "groups";

export function settingsHref(section?: SettingsSection): string {
  return section ? `#settings/${section}` : "#settings";
}

/** The Settings section a hash points at ("#settings/groups"), else null. */
export function settingsSection(hash: string): SettingsSection | null {
  return /^#\/?settings\/groups\/?$/i.test(hash) ? "groups" : null;
}
