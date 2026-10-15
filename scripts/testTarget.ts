/**
 * Safety guard for anything that writes test data. Seeding and the
 * integration/UI tests against a real database may only run against the
 * budget-buddy-test project or a local Supabase, never production.
 */

/** The hosted test project (budget-buddy-test). Production is lkaurrcarzzkbqdwqfge. */
export const TEST_PROJECT_REF = "kiqbgjgvptgknmboazaq";

const ALLOWED_HOSTS = [`${TEST_PROJECT_REF}.supabase.co`, "127.0.0.1", "localhost"];

/** True when the URL points at the test project or a local Supabase. */
export function isTestTarget(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ALLOWED_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Throws unless the URL is the test project or a local Supabase. */
export function assertTestTarget(url: string | undefined): asserts url is string {
  if (!isTestTarget(url)) {
    throw new Error(
      `Refusing to write test data to ${url || "(no URL)"}: only the test project ` +
        `(${TEST_PROJECT_REF}) or a local Supabase (127.0.0.1 / localhost) is allowed.`,
    );
  }
}
