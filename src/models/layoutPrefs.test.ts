import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./collapsedGroups";
import {
  compactRowsKey,
  loadCompactRows,
  loadSidebarCollapsed,
  saveCompactRows,
  saveSidebarCollapsed,
  sidebarKey,
} from "./layoutPrefs";

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

describe("compact rows preference", () => {
  it("starts with full rows", () => {
    expect(loadCompactRows(fakeStorage(), "u1")).toBe(false);
    expect(loadCompactRows(null, "u1")).toBe(false);
  });

  it("remembers compact rows per user", () => {
    const storage = fakeStorage();
    saveCompactRows(storage, "u1", true);
    expect(storage.items.get(compactRowsKey("u1"))).toBe("1");
    expect(loadCompactRows(storage, "u1")).toBe(true);
    expect(loadCompactRows(storage, "u2")).toBe(false);
    saveCompactRows(storage, "u1", false);
    expect(loadCompactRows(storage, "u1")).toBe(false);
  });

  it("treats unknown values and blocked storage as full rows", () => {
    expect(loadCompactRows(fakeStorage({ [compactRowsKey("u1")]: "yes" }), "u1")).toBe(false);
    expect(loadCompactRows(throwing, "u1")).toBe(false);
    expect(() => saveCompactRows(throwing, "u1", true)).not.toThrow();
  });
});
