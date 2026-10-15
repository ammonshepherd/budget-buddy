/**
 * Reads the test-database settings. Values already in the environment win
 * (GitHub Actions passes them from repository secrets); otherwise they come
 * from .env.test. Never reads .env.local, which points at production.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const ENV_FILE = resolve(import.meta.dirname, "..", ".env.test");

export interface TestEnv {
  url: string;
  anonKey: string;
  /** Server-side only: never give it a VITE_ prefix. Only the seed script needs it. */
  serviceRoleKey: string;
  users: { a: TestUser; b: TestUser };
}

export interface TestUser {
  email: string;
  password: string;
}

function fileValues(): Record<string, string | undefined> {
  return existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
}

/** The settings found, with "" for anything missing. */
export function readTestEnv(): TestEnv {
  const file = fileValues();
  const get = (name: string) => process.env[name] || file[name] || "";
  return {
    url: get("VITE_SUPABASE_URL"),
    anonKey: get("VITE_SUPABASE_ANON_KEY"),
    serviceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    users: {
      a: { email: get("TEST_USER_A_EMAIL"), password: get("TEST_USER_A_PASSWORD") },
      b: { email: get("TEST_USER_B_EMAIL"), password: get("TEST_USER_B_PASSWORD") },
    },
  };
}

/**
 * Why the database tests cannot run, or null when everything they need (URL,
 * publishable key, both users) is set. The service-role key is not needed:
 * the tests sign in as the test users.
 */
export function missingForTests(env: TestEnv): string | null {
  const missing = [
    ["VITE_SUPABASE_URL", env.url],
    ["VITE_SUPABASE_ANON_KEY", env.anonKey],
    ["TEST_USER_A_EMAIL", env.users.a.email],
    ["TEST_USER_A_PASSWORD", env.users.a.password],
    ["TEST_USER_B_EMAIL", env.users.b.email],
    ["TEST_USER_B_PASSWORD", env.users.b.password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return missing.length
    ? `test database not configured (missing ${missing.join(", ")}); see docs/testing.md`
    : null;
}

/** Sets NAME=value in .env.test, replacing an existing line or adding one. */
export function writeEnvValue(name: string, value: string): void {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = pattern.test(text)
    ? text.replace(pattern, line)
    : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  writeFileSync(ENV_FILE, next, { mode: 0o600 });
}
