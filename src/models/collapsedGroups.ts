/**
 * Which envelope groups are collapsed on the Budget page: a per-device
 * preference, kept in localStorage (never in Supabase) as a JSON array of
 * group ids, one key per user so two people sharing a device keep their own.
 * Any storage failure or corrupt value means "all expanded".
 */

/** The part of `Storage` used here, so tests can pass a fake. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export const collapsedGroupsKey = (userId: string) => `bb.budget.collapsedGroups.${userId}`;

/** The browser's localStorage, or null where it cannot even be reached. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The collapsed group ids saved for this user; empty when none or unreadable. */
export function loadCollapsedGroups(storage: KeyValueStorage | null, userId: string): string[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(collapsedGroupsKey(userId)) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Saves the collapsed group ids, leaving out any that no longer match a
 * group (deleted groups). Failures are ignored: the page keeps working.
 */
export function saveCollapsedGroups(
  storage: KeyValueStorage | null,
  userId: string,
  collapsed: Iterable<string>,
  groupIds: Iterable<string>,
): void {
  const existing = new Set(groupIds);
  const ids = [...new Set(collapsed)].filter((id) => existing.has(id));
  try {
    storage?.setItem(collapsedGroupsKey(userId), JSON.stringify(ids));
  } catch {
    // Storage full or blocked: the state lasts until the page closes.
  }
}
