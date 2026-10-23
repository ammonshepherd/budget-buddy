import { useEffect, useState } from "react";
import { browserStorage } from "../models/collapsedGroups";
import {
  DESKTOP_QUERY,
  loadAccountPaneCollapsed,
  loadCompactRows,
  loadSidebarCollapsed,
  saveAccountPaneCollapsed,
  saveCompactRows,
  saveSidebarCollapsed,
  type Sidebar,
} from "../models/layoutPrefs";

const matchesDesktop = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DESKTOP_QUERY).matches
    : false;

/**
 * True while the window is wide enough for the desktop layout (1000px and
 * up). It follows the window as it is resized.
 */
export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(matchesDesktop);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return desktop;
}

/**
 * Whether a desktop sidebar (the left navigation or the right panel) is
 * collapsed to icons, remembered on this device for this user.
 */
export function useSidebar(sidebar: Sidebar, userId: string) {
  const [collapsed, setCollapsed] = useState(() =>
    loadSidebarCollapsed(browserStorage(), sidebar, userId),
  );

  const set = (next: boolean) => {
    setCollapsed(next);
    saveSidebarCollapsed(browserStorage(), sidebar, userId, next);
  };

  return {
    collapsed,
    toggle: () => set(!collapsed),
    expand: () => {
      if (collapsed) set(false);
    },
  };
}

/**
 * Whether the Budget page's envelope rows are compact (name, Saved and what
 * is left only), remembered on this device for this user.
 */
export function useCompactRows(userId: string) {
  const [compact, setCompact] = useState(() => loadCompactRows(browserStorage(), userId));

  return {
    compact,
    toggle: () => {
      setCompact(!compact);
      saveCompactRows(browserStorage(), userId, !compact);
    },
  };
}

/**
 * Whether an open account's info pane is collapsed to its name and Current
 * balance (phone), remembered on this device for this user.
 */
export function useAccountPaneCollapsed(userId: string) {
  const [collapsed, setCollapsed] = useState(() =>
    loadAccountPaneCollapsed(browserStorage(), userId),
  );

  return {
    collapsed,
    toggle: () => {
      setCollapsed(!collapsed);
      saveAccountPaneCollapsed(browserStorage(), userId, !collapsed);
    },
  };
}
