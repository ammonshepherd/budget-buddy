import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./collapsedGroups";
import { loadSidebarCollapsed, saveSidebarCollapsed, sidebarKey } from "./layoutPrefs";

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } satisfies KeyValueStorage & { items: Map<string, string> };
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("sidebar preferences", () => {
  it("starts expanded", () => {
    expect(loadSidebarCollapsed(fakeStorage(), "nav", "u1")).toBe(false);
    expect(loadSidebarCollapsed(null, "panel", "u1")).toBe(false);
  });

  it("remembers each sidebar per user", () => {
    const storage = fakeStorage();
    saveSidebarCollapsed(storage, "nav", "u1", true);
    expect(storage.items.get(sidebarKey("nav", "u1"))).toBe("1");
    expect(loadSidebarCollapsed(storage, "nav", "u1")).toBe(true);
    expect(loadSidebarCollapsed(storage, "panel", "u1")).toBe(false);
    expect(loadSidebarCollapsed(storage, "nav", "u2")).toBe(false);
    saveSidebarCollapsed(storage, "nav", "u1", false);
    expect(loadSidebarCollapsed(storage, "nav", "u1")).toBe(false);
  });

  it("treats unknown values and blocked storage as expanded", () => {
    expect(
      loadSidebarCollapsed(fakeStorage({ [sidebarKey("nav", "u1")]: "yes" }), "nav", "u1"),
    ).toBe(false);
    expect(loadSidebarCollapsed(throwing, "nav", "u1")).toBe(false);
    expect(() => saveSidebarCollapsed(throwing, "nav", "u1", true)).not.toThrow();
  });
});
