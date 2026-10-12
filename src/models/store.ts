/**
 * Picks the app's data store once, at build time. Vite replaces
 * import.meta.env.VITE_DATA_STORE with a constant, so a normal build never
 * ships the in-memory test store.
 */
import type { DataStore } from "./dataStore";
import { createMemoryStore } from "./memoryStore";
import { createSupabaseStore } from "./supabaseStore";

export const store: DataStore =
  import.meta.env.VITE_DATA_STORE === "memory" ? createMemoryStore() : createSupabaseStore();
