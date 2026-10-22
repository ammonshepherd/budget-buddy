/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** Injected by `define` in vite.config.ts from package.json. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "memory" builds the app with the in-memory store, for UI tests. */
  readonly VITE_DATA_STORE?: "memory";
}
