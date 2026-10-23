/**
 * The desktop layout's collapsible sidebars: the left navigation and the
 * right panel (Budget, Accounts). Like collapsed groups, a
 * per-device preference in localStorage (never in Supabase), one key per user.
 * Any storage failure or unknown value means "expanded".
 */
import type { KeyValueStorage } from "./collapsedGroups";

/** The width (CSS pixels) from which the desktop layout replaces the phone one. */
export const DESKTOP_MIN_WIDTH = 1000;

/** The media query for DESKTOP_MIN_WIDTH, shared by the CSS (62.5rem) and the views. */
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

export type Sidebar = "nav" | "panel";

export const sidebarKey = (sidebar: Sidebar, userId: string) =>
  `bb.layout.${sidebar}Collapsed.${userId}`;

/** Whether this sidebar was left collapsed on this device; false when unknown. */
export function loadSidebarCollapsed(
  storage: KeyValueStorage | null,
  sidebar: Sidebar,
  userId: string,
): boolean {
  try {
    return storage?.getItem(sidebarKey(sidebar, userId)) === "1";
  } catch {
    return false;
  }
}

/** Remembers whether this sidebar is collapsed. Failures are ignored. */
export function saveSidebarCollapsed(
  storage: KeyValueStorage | null,
  sidebar: Sidebar,
  userId: string,
  collapsed: boolean,
): void {
  try {
    storage?.setItem(sidebarKey(sidebar, userId), collapsed ? "1" : "0");
  } catch {
    // Storage full or blocked: the state lasts until the page closes.
  }
}

export const compactRowsKey = (userId: string) => `bb.budget.compactRows.${userId}`;

/**
 * Whether the Budget page's envelope rows were left compact (name, Saved and
 * what is left only) on this device; false when unknown.
 */
export function loadCompactRows(storage: KeyValueStorage | null, userId: string): boolean {
  try {
    return storage?.getItem(compactRowsKey(userId)) === "1";
  } catch {
    return false;
  }
}

/** Remembers whether the envelope rows are compact. Failures are ignored. */
export function saveCompactRows(
  storage: KeyValueStorage | null,
  userId: string,
  compact: boolean,
): void {
  try {
    storage?.setItem(compactRowsKey(userId), compact ? "1" : "0");
  } catch {
    // Storage full or blocked: the state lasts until the page closes.
  }
}

export const accountPaneKey = (userId: string) => `bb.accounts.paneCollapsed.${userId}`;

/**
 * Whether an open account's info pane was left collapsed (name and Current
 * balance only) on this device; false when unknown. Phone only.
 */
export function loadAccountPaneCollapsed(storage: KeyValueStorage | null, userId: string): boolean {
  try {
    return storage?.getItem(accountPaneKey(userId)) === "1";
  } catch {
    return false;
  }
}

/** Remembers whether the info pane is collapsed. Failures are ignored. */
export function saveAccountPaneCollapsed(
  storage: KeyValueStorage | null,
  userId: string,
  collapsed: boolean,
): void {
  try {
    storage?.setItem(accountPaneKey(userId), collapsed ? "1" : "0");
  } catch {
    // Storage full or blocked: the state lasts until the page closes.
  }
}
