/**
 * Shared settings for tests against the test database (never production).
 * `skipReason` is set when the test database is not configured, so suites can
 * skip with a clear message instead of failing.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/models/database.types";
import { missingForTests, readTestEnv, type TestUser } from "../scripts/testEnv";
import { assertTestTarget } from "../scripts/testTarget";

export const testEnv = readTestEnv();
export const skipReason = missingForTests(testEnv);
if (!skipReason) assertTestTarget(testEnv.url);

/** A Supabase client signed in as a test user with the publishable key, like the app. */
export async function signInAs(user: TestUser): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(testEnv.url, testEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword(user);
  if (error) throw new Error(`sign in as ${user.email}: ${error.message}`);
  return client;
}
