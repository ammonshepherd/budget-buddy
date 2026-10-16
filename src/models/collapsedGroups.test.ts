import { describe, expect, it } from "vitest";
import {
  collapsedGroupsKey,
  loadCollapsedGroups,
  saveCollapsedGroups,
  type KeyValueStorage,
} from "./collapsedGroups";

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

describe("collapsed groups", () => {
  it("starts with every group expanded", () => {
    expect(loadCollapsedGroups(fakeStorage(), "u1")).toEqual([]);
  });

  it("keeps each user's collapsed group ids under their own key", () => {
    const storage = fakeStorage();
    saveCollapsedGroups(storage, "u1", ["a"], ["a", "b"]);
    saveCollapsedGroups(storage, "u2", ["b"], ["a", "b"]);
    expect(storage.items.get(collapsedGroupsKey("u1"))).toBe('["a"]');
    expect(loadCollapsedGroups(storage, "u1")).toEqual(["a"]);
    expect(loadCollapsedGroups(storage, "u2")).toEqual(["b"]);
  });

  it("prunes ids of deleted groups when saving", () => {
    const storage = fakeStorage();
    saveCollapsedGroups(storage, "u1", ["gone", "a", "a"], ["a", "b"]);
    expect(loadCollapsedGroups(storage, "u1")).toEqual(["a"]);
  });

  it("treats a corrupt value as all expanded", () => {
    const key = collapsedGroupsKey("u1");
    expect(loadCollapsedGroups(fakeStorage({ [key]: "{not json" }), "u1")).toEqual([]);
    expect(loadCollapsedGroups(fakeStorage({ [key]: '{"a":1}' }), "u1")).toEqual([]);
    expect(loadCollapsedGroups(fakeStorage({ [key]: '["a",3,null]' }), "u1")).toEqual(["a"]);
  });

  it("keeps working when storage is unavailable", () => {
    expect(loadCollapsedGroups(throwing, "u1")).toEqual([]);
    expect(() => saveCollapsedGroups(throwing, "u1", ["a"], ["a"])).not.toThrow();
    expect(loadCollapsedGroups(null, "u1")).toEqual([]);
    expect(() => saveCollapsedGroups(null, "u1", ["a"], ["a"])).not.toThrow();
  });
});
