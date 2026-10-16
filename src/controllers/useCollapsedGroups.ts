import { useState } from "react";
import {
  browserStorage,
  loadCollapsedGroups,
  saveCollapsedGroups,
} from "../models/collapsedGroups";

/**
 * Which Budget page groups are collapsed, remembered on this device for this
 * user (across reloads, pages and months). New groups start expanded.
 */
export function useCollapsedGroups(userId: string, groupIds: string[]) {
  const [collapsed, setCollapsed] = useState(
    () => new Set(loadCollapsedGroups(browserStorage(), userId)),
  );

  const setGroup = (groupId: string, collapse: boolean) => {
    const next = new Set(collapsed);
    if (collapse) next.add(groupId);
    else next.delete(groupId);
    setCollapsed(next);
    saveCollapsedGroups(browserStorage(), userId, next, groupIds);
  };

  return {
    isCollapsed: (groupId: string) => collapsed.has(groupId),
    toggle: (groupId: string) => setGroup(groupId, !collapsed.has(groupId)),
    expand: (groupId: string) => {
      if (collapsed.has(groupId)) setGroup(groupId, false);
    },
  };
}
